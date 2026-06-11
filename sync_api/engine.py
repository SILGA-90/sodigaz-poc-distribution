"""
Moteur de synchronisation offline-first.

SyncEngine encapsule toute la logique pull/push pour un livreur authentifié.
Les vues HTTP dans views.py instancient SyncEngine et délèguent le traitement.

Flux nominal d'un cycle (côté mobile) :
  1. pushClotures()  -> clôturer les programmes finis avant de tirer les données
  2. pull()          -> récupérer les nouveautés serveur depuis lastPulledAt
  3. push()          -> envoyer les opérations/anomalies créées hors ligne
"""
import logging
import time
from datetime import date, timedelta

logger = logging.getLogger(__name__)

from django.contrib.gis.geos import Point
from django.db import models, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from distribution.models import (
    Anomalie,
    Client,
    Etape,
    LigneOperation,
    LigneProgramme,
    Operation,
    Photo,
    Plv,
    Article,
    Programme,
)

from .push_serializers import (
    AnomaliePushSerializer,
    LigneOperationPushSerializer,
    OperationPushSerializer,
    PhotoPushSerializer,
)
from .serializers import (
    AnomalieSyncSerializer,
    ClientSyncSerializer,
    EtapeSyncSerializer,
    LigneOperationSyncSerializer,
    LigneProgrammeSyncSerializer,
    OperationSyncSerializer,
    ArticleSyncSerializer,
    PlvSyncSerializer,
    ProgrammeSyncSerializer,
)


def now_ms() -> int:
    """
    Retourne le timestamp courant en millisecondes entières.
    WatermelonDB et notre protocole utilisent des timestamps en ms
    (BigInt côté SQLite mobile). Python time.time() retourne des secondes
    flottantes ; on multiplie par 1000 et on tronque à l'entier.
    """
    return int(time.time() * 1000)


# ===========================================================================
# MOTEUR DE SYNCHRONISATION
# ===========================================================================

class SyncEngine:
    """
    Encapsule toute la logique de synchronisation offline-first pour un livreur.

    Instancier une fois par requête HTTP avec l'utilisateur authentifié.
    Les entités autorisées (étapes, programmes) sont chargées une seule fois
    via _preload_autorises() et réutilisées dans les boucles de traitement,
    évitant ainsi les requêtes N+1 sur de gros payloads.

    Responsabilités :
      - build_pull_response()  : construit le delta descendant (serveur -> mobile)
      - apply_push()           : applique le delta ascendant (mobile -> serveur)
    """

    def __init__(self, user):
        self.user = user
        # Chargés paresseusement par _preload_autorises(), avant le push.
        self._programmes_user_uuids   = None
        self._etapes_user_ids_by_uuid = None
        self._etapes_autres_users     = None

    # ------------------------------------------------------------------
    # PULL
    # ------------------------------------------------------------------

    def build_pull_response(self, last_pulled_at: int) -> Response:
        """
        Construit la réponse pull : renvoie tous les enregistrements modifiés
        depuis last_pulled_at pour le livreur connecté.

        Le timestamp serveur est capturé AVANT les requêtes DB : tout
        enregistrement modifié pendant l'exécution du pull aura un last_modified
        supérieur au timestamp capturé, donc il sera renvoyé au prochain pull.
        Aucun trou possible dans le delta.

        La fenêtre de 90 jours borne la taille de la base locale. Un livreur
        n'a pas besoin de l'historique complet sur son téléphone ;
        l'historique complet reste disponible côté supervision web.
        """
        server_timestamp = now_ms()
        date_min = date.today() - timedelta(days=90)

        programmes_qs = Programme.objects.filter(
            utilisateur=self.user,
            date_programme__gte=date_min,
        )
        programmes_ids = list(programmes_qs.values_list("id", flat=True))

        # Référentiels : données maîtres partagées entre tous les livreurs.
        clients_changes  = self._build_changes(
            Client.objects.all(), last_pulled_at, ClientSyncSerializer,
            has_soft_delete=False, has_last_modified=False,
        )
        plvs_changes     = self._build_changes(
            Plv.objects.all(), last_pulled_at, PlvSyncSerializer,
            has_soft_delete=False, has_last_modified=False,
        )
        articles_changes = self._build_changes(
            Article.objects.all(), last_pulled_at, ArticleSyncSerializer,
            has_soft_delete=False, has_last_modified=False,
        )

        # Données de planification : filtrées par livreur.
        programmes_changes = self._build_changes(
            programmes_qs, last_pulled_at, ProgrammeSyncSerializer,
        )

        etapes_qs    = Etape.objects.filter(programme_id__in=programmes_ids)
        etapes_changes = self._build_changes(etapes_qs, last_pulled_at, EtapeSyncSerializer)

        etapes_ids   = list(etapes_qs.values_list("id", flat=True))
        lignes_prog_qs = LigneProgramme.objects.filter(etape_id__in=etapes_ids)
        lignes_prog_changes = self._build_changes(
            lignes_prog_qs, last_pulled_at, LigneProgrammeSyncSerializer,
        )

        # Données terrain : re-pull pour récupérer d'éventuelles corrections
        # superviseur (un superviseur peut corriger une opération côté web).
        operations_qs = Operation.objects.filter(
            etape_id__in=etapes_ids,
        ).select_related("etape")
        operations_changes = self._build_changes(
            operations_qs, last_pulled_at, OperationSyncSerializer,
        )
        operations_ids = list(operations_qs.values_list("id", flat=True))

        lignes_op_qs = LigneOperation.objects.filter(
            operation_id__in=operations_ids,
        ).select_related("operation", "produit")
        lignes_op_changes = self._build_changes(
            lignes_op_qs, last_pulled_at, LigneOperationSyncSerializer,
        )

        anomalies_qs = Anomalie.objects.filter(programme_id__in=programmes_ids)
        anomalies_changes = self._build_changes(
            anomalies_qs, last_pulled_at, AnomalieSyncSerializer,
        )

        return Response({
            "changes": {
                "client":          clients_changes,
                "plv":             plvs_changes,
                "article":         articles_changes,
                "programme":       programmes_changes,
                "etape":           etapes_changes,
                "ligne_programme": lignes_prog_changes,
                "operation":       operations_changes,
                "ligne_operation": lignes_op_changes,
                "anomalie":        anomalies_changes,
            },
            "timestamp": server_timestamp,
        })

    @staticmethod
    def _build_changes(queryset, last_pulled_at, serializer_class,
                       has_soft_delete=True, has_last_modified=True):
        """
        Construit le dictionnaire { created, updated, deleted } attendu par
        le client mobile pour une table donnée.

        WatermelonDB traite created et updated de façon identique
        (INSERT OR REPLACE). On met tout dans updated pour simplifier :
        le client ne fait pas de distinction.

        Client, PLV et Article n'ont pas de colonne last_modified (données
        maîtres X3, rarement modifiées). On envoie tout au premier pull
        (last_pulled_at == 0) et rien ensuite.

        On ne supprime jamais physiquement de données. Les enregistrements
        avec is_deleted=True sont transmis dans deleted pour que le mobile
        puisse les retirer de son affichage.
        """
        if has_last_modified:
            qs = queryset.filter(last_modified__gt=last_pulled_at)
        else:
            qs = queryset if last_pulled_at == 0 else queryset.none()

        if has_soft_delete:
            active_qs     = qs.filter(is_deleted=False)
            deleted_uuids = list(qs.filter(is_deleted=True).values_list("uuid", flat=True))
        else:
            active_qs     = qs
            deleted_uuids = []

        return {
            "created": [],
            "updated": serializer_class(active_qs, many=True).data,
            "deleted": [str(u) for u in deleted_uuids],
        }

    # ------------------------------------------------------------------
    # PUSH
    # ------------------------------------------------------------------

    def apply_push(self, changes: dict, echec_etapes: list) -> Response:
        """
        Applique le payload ascendant : persiste les données créées hors ligne
        par le livreur. Traite les entités dans l'ordre parent -> enfant :
        Operations -> LignesOperation -> Anomalies -> Photos.

        Si une ligne du payload échoue à la validation DRF (is_valid), une
        ValidationError est levée, ce qui provoque le rollback de la transaction.
        Un refus de sécurité (403) retourne une réponse sans rollback : les
        données déjà traitées dans le même payload sont conservées.

        Le push est idempotent : update_or_create garantit l'absence de
        doublons si le mobile rejoue le même payload (l'UUID mobile fait foi).
        """
        self._preload_autorises()

        applied = {
            "operation":       {"created": 0, "updated": 0, "deleted": 0},
            "ligne_operation": {"created": 0, "updated": 0, "deleted": 0},
            "anomalie":        {"created": 0, "updated": 0, "deleted": 0},
            "photo":           {"created": 0, "updated": 0, "deleted": 0},
        }
        pushed_op_uuids: list[str]  = []
        touched_etape_ids: set[int] = set()

        with transaction.atomic():
            if err := self._apply_operations(changes, applied, pushed_op_uuids, touched_etape_ids):
                return err
            if err := self._apply_lignes_operation(changes, applied):
                return err
            if err := self._apply_anomalies(changes, applied):
                return err
            if err := self._apply_photos(changes, applied):
                return err
            self._update_statuts(touched_etape_ids)
            self._mark_echec_etapes(echec_etapes)

        self._sync_x3(pushed_op_uuids)
        return Response({"status": "ok", "applied": applied}, status=status.HTTP_200_OK)

    def _preload_autorises(self):
        """
        Charge en mémoire les UUIDs/IDs autorisés pour ce livreur.
        Appelé une seule fois avant la boucle de push, évitant N requêtes DB.
        """
        if self._programmes_user_uuids is not None:
            return

        self._programmes_user_uuids = set(
            str(u) for u in
            Programme.objects.filter(utilisateur=self.user).values_list("uuid", flat=True)
        )
        self._etapes_user_ids_by_uuid = {
            str(e.uuid): e.id for e in
            Etape.objects.filter(programme__utilisateur=self.user).only("id", "uuid")
        }
        # UUIDs d'étapes d'autres livreurs : permet de distinguer usurpation
        # d'une étape inconnue (bug client ou données de test).
        self._etapes_autres_users = set(
            str(u) for u in
            Etape.objects.exclude(programme__utilisateur=self.user)
            .values_list("uuid", flat=True)
        )

    def _apply_operations(self, changes, applied, pushed_op_uuids, touched_etape_ids):
        """
        Crée ou met à jour chaque opération terrain du livreur.
        Fusionne created + updated car le mobile ne distingue pas toujours
        les deux (une opération éditée offline peut apparaître dans updated
        alors que le serveur ne la connaît pas encore).
        Retourne None si tout est OK, une Response d'erreur sinon.
        """
        for op_data in (
            changes.get("operation", {}).get("created", [])
            + changes.get("operation", {}).get("updated", [])
        ):
            op_serializer = OperationPushSerializer(data=op_data)
            op_serializer.is_valid(raise_exception=True)
            d = op_serializer.validated_data

            etape_uuid_str = str(d["etape_uuid"])
            etape_id = self._etapes_user_ids_by_uuid.get(etape_uuid_str)
            if etape_id is None:
                if etape_uuid_str in self._etapes_autres_users:
                    # Refus explicite plutôt qu'ignoré silencieusement,
                    # pour détecter une tentative d'usurpation côté logs.
                    return Response(
                        {"status": "error", "detail": f"Etape {etape_uuid_str} non autorisee."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                logger.warning(
                    "push: operation %s ignoree : etape %s inconnue pour %s",
                    d["uuid"], etape_uuid_str, self.user.code_livreur,
                )
                continue

            pushed_op_uuids.append(str(d["uuid"]))
            touched_etape_ids.add(etape_id)
            _, created = Operation.objects.update_or_create(
                uuid=d["uuid"],
                defaults={
                    "etape_id":              etape_id,
                    "type_operation":        d["type_operation"],
                    "sous_type":             d.get("sous_type") or None,
                    "date_heure":            d["date_heure"],
                    "localisation_saisie":   self._to_point(d),
                    "mode_paiement":         d.get("mode_paiement") or None,
                    "montant_total":         d["montant_total"],
                    "montant_encaisse":      d["montant_encaisse"],
                    "est_encaissee":         d["est_encaissee"],
                    "signature_livreur":     d.get("signature_livreur", ""),
                    "signature_client":      d.get("signature_client", ""),
                    "nom_signataire_client": d.get("nom_signataire_client", ""),
                    "commentaire":           d.get("commentaire", ""),
                    "gps_precision":         d.get("gps_precision"),
                    "gps_horodatage":        d.get("gps_horodatage"),
                    "is_deleted":            False,
                },
            )
            applied["operation"]["created" if created else "updated"] += 1

        # Suppressions logiques : is_deleted=True, pas de DELETE SQL.
        # La suppression physique casserait l'audit trail et le re-pull.
        for uuid_to_delete in changes.get("operation", {}).get("deleted", []):
            n = Operation.objects.filter(
                uuid=uuid_to_delete,
                etape__programme__utilisateur=self.user,
            ).update(is_deleted=True)
            applied["operation"]["deleted"] += n

        return None

    def _apply_lignes_operation(self, changes, applied):
        """
        Crée ou met à jour les lignes de détail article par article.
        La ligne référence l'article par code_x3 (clé métier X3, plus stable
        face aux resets de base que l'id Django).
        Retourne None si tout est OK, une Response d'erreur sinon.
        """
        for ligne_data in (
            changes.get("ligne_operation", {}).get("created", [])
            + changes.get("ligne_operation", {}).get("updated", [])
        ):
            lo_serializer = LigneOperationPushSerializer(data=ligne_data)
            lo_serializer.is_valid(raise_exception=True)
            d = lo_serializer.validated_data

            operation = Operation.objects.filter(uuid=d["operation_uuid"]).first()
            if operation is None:
                logger.warning(
                    "push: ligne %s ignoree : operation %s inconnue pour %s",
                    d["uuid"], d["operation_uuid"], self.user.code_livreur,
                )
                continue
            if operation.etape.programme.utilisateur_id != self.user.id:
                return Response(
                    {"status": "error", "detail": f"Operation {d['operation_uuid']} non autorisee."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            article = get_object_or_404(Article, code_x3=d["produit_code_x3"])
            _, created = LigneOperation.objects.update_or_create(
                uuid=d["uuid"],
                defaults={
                    "operation_id":            operation.id,
                    "produit_id":              article.id,
                    "quantite_realisee":       d["quantite_realisee"],
                    "quantite_collectee_vide": d["quantite_collectee_vide"],
                    "quantite_consignee":       d["quantite_consignee"],
                    "quantite_deconsignee":     d["quantite_deconsignee"],
                    "montant_ligne":            d["montant_ligne"],
                    "is_deleted":               False,
                },
            )
            applied["ligne_operation"]["created" if created else "updated"] += 1

        for uuid_to_delete in changes.get("ligne_operation", {}).get("deleted", []):
            n = LigneOperation.objects.filter(
                uuid=uuid_to_delete,
                operation__etape__programme__utilisateur=self.user,
            ).update(is_deleted=True)
            applied["ligne_operation"]["deleted"] += n

        return None

    def _apply_anomalies(self, changes, applied):
        """
        Crée ou met à jour les anomalies terrain.
        Rattachées au programme (pas à une étape), car une anomalie peut
        survenir hors visite de PLV (accident de route, matériel, etc.).
        Retourne None si tout est OK, une Response d'erreur sinon.
        """
        for ano_data in (
            changes.get("anomalie", {}).get("created", [])
            + changes.get("anomalie", {}).get("updated", [])
        ):
            an_serializer = AnomaliePushSerializer(data=ano_data)
            an_serializer.is_valid(raise_exception=True)
            d = an_serializer.validated_data

            programme = Programme.objects.filter(
                uuid=d["programme_uuid"],
                utilisateur=self.user,
            ).first()
            if programme is None:
                if Programme.objects.filter(uuid=d["programme_uuid"]).exists():
                    return Response(
                        {"status": "error", "detail": f"Programme {d['programme_uuid']} non autorise."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                logger.warning(
                    "push: anomalie %s ignoree : programme %s inconnu pour %s",
                    d["uuid"], d["programme_uuid"], self.user.code_livreur,
                )
                continue

            _, created = Anomalie.objects.update_or_create(
                uuid=d["uuid"],
                defaults={
                    "programme_id":  programme.id,
                    "plv_id":        d.get("plv_id"),
                    "type_anomalie": d["type_anomalie"],
                    "gravite":       d["gravite"],
                    "description":   d["description"],
                    "statut":        d["statut"],
                    "date_heure":    d["date_heure"],
                    "localisation":  self._to_point(d),
                    "is_deleted":    False,
                },
            )
            applied["anomalie"]["created" if created else "updated"] += 1

        for uuid_to_delete in changes.get("anomalie", {}).get("deleted", []):
            n = Anomalie.objects.filter(
                uuid=uuid_to_delete,
                programme__utilisateur=self.user,
            ).update(is_deleted=True)
            applied["anomalie"]["deleted"] += n

        return None

    def _apply_photos(self, changes, applied):
        """
        Enregistre les métadonnées des photos (JSON uniquement).
        Le fichier binaire arrive séparément via l'endpoint /upload/.
        Séparer JSON et binaire simplifie la gestion des erreurs et permet
        de re-tenter l'upload sans repousser toutes les données JSON.
        Retourne None si tout est OK, une Response d'erreur sinon.
        """
        for photo_data in (
            changes.get("photo", {}).get("created", [])
            + changes.get("photo", {}).get("updated", [])
        ):
            ph_serializer = PhotoPushSerializer(data=photo_data)
            ph_serializer.is_valid(raise_exception=True)
            d = ph_serializer.validated_data

            operation_id = None
            anomalie_id  = None

            if d.get("operation_uuid"):
                err, operation_id = self._resolve_operation_photo(d)
                if err:
                    return err
                if operation_id is None:
                    continue
            else:
                err, anomalie_id = self._resolve_anomalie_photo(d)
                if err:
                    return err
                if anomalie_id is None:
                    continue

            defaults = {
                "operation_id": operation_id,
                "anomalie_id":  anomalie_id,
                "type_photo":   d["type_photo"],
                "date_heure":   d["date_heure"],
                "taille_octets": d.get("taille_octets"),
                "is_deleted":   False,
            }
            if d.get("latitude") is not None and d.get("longitude") is not None:
                defaults["localisation"] = Point(d["longitude"], d["latitude"], srid=4326)

            existing = Photo.objects.filter(uuid=d["uuid"]).first()
            if existing:
                for k, v in defaults.items():
                    setattr(existing, k, v)
                existing.save()
                applied["photo"]["updated"] += 1
            else:
                # Placeholder binaire : le vrai fichier arrive via /upload/.
                # ImageField Django exige une valeur non-nulle à la création.
                Photo.objects.create(uuid=d["uuid"], fichier="placeholder.bin", **defaults)
                applied["photo"]["created"] += 1

        for uuid_to_delete in changes.get("photo", {}).get("deleted", []):
            photos = Photo.objects.filter(uuid=uuid_to_delete).filter(
                models.Q(operation__etape__programme__utilisateur=self.user)
                | models.Q(anomalie__programme__utilisateur=self.user)
            )
            applied["photo"]["deleted"] += photos.update(is_deleted=True)

        return None

    def _resolve_operation_photo(self, d):
        """
        Vérifie que l'opération rattachée à une photo appartient au livreur,
        et valide la cohérence temporelle (tolérance 2h).
        Retourne (error_response, operation_id) — l'un des deux est None.
        """
        op = Operation.objects.filter(
            uuid=d["operation_uuid"],
            etape__programme__utilisateur=self.user,
        ).first()
        if op is None:
            logger.warning(
                "push: photo %s ignoree : operation %s inconnue pour %s",
                d["uuid"], d["operation_uuid"], self.user.code_livreur,
            )
            return None, None
        if op.etape.programme.utilisateur_id != self.user.id:
            return (
                Response(
                    {"status": "error", "detail": f"Operation {d['operation_uuid']} non autorisee."},
                    status=status.HTTP_403_FORBIDDEN,
                ),
                None,
            )

        # Validation anti-fraude : tolérance 2h entre la photo et l'opération.
        # Tolérance généreuse pour couvrir les photos prises légèrement
        # avant/après le formulaire en terrain.
        MAX_DELTA = 2 * 3600
        photo_dt = d["date_heure"]
        op_dt    = op.date_heure
        if photo_dt.tzinfo is None:
            from django.utils.timezone import make_aware
            photo_dt = make_aware(photo_dt)
        if op_dt.tzinfo is None:
            from django.utils.timezone import make_aware
            op_dt = make_aware(op_dt)
        if abs((photo_dt - op_dt).total_seconds()) > MAX_DELTA:
            logger.warning(
                "push: photo %s rejetee : ecart temporel %.0f s (max %d s) "
                "par rapport a l'operation %s pour %s",
                d["uuid"], abs((photo_dt - op_dt).total_seconds()), MAX_DELTA,
                d["operation_uuid"], self.user.code_livreur,
            )
            return None, None

        return None, op.id

    def _resolve_anomalie_photo(self, d):
        """
        Vérifie que l'anomalie rattachée à une photo appartient au livreur.
        Retourne (error_response, anomalie_id) — l'un des deux est None.
        """
        an = Anomalie.objects.filter(uuid=d["anomalie_uuid"]).first()
        if an is None:
            logger.warning(
                "push: photo %s ignoree : anomalie %s inconnue pour %s",
                d["uuid"], d["anomalie_uuid"], self.user.code_livreur,
            )
            return None, None
        if an.programme.utilisateur_id != self.user.id:
            return (
                Response(
                    {"status": "error", "detail": f"Anomalie {d['anomalie_uuid']} non autorisee."},
                    status=status.HTTP_403_FORBIDDEN,
                ),
                None,
            )
        return None, an.id

    def _update_statuts(self, touched_etape_ids):
        """
        Passe les étapes touchées en VISITEE et les programmes en EN_COURS.
        Ces transitions sont calculées côté serveur plutôt que transmises
        par le mobile pour éviter qu'un bug client envoie un mauvais statut.
        """
        if not touched_etape_ids:
            return
        Etape.objects.filter(id__in=touched_etape_ids).update(statut_visite="VISITEE")
        prog_ids = list(
            Etape.objects.filter(id__in=touched_etape_ids)
            .values_list("programme_id", flat=True)
            .distinct()
        )
        Programme.objects.filter(
            id__in=prog_ids, statut="PLANIFIE",
        ).update(statut="EN_COURS", heure_debut=timezone.now())

    def _mark_echec_etapes(self, echec_etapes):
        """
        Marque les étapes non visitées (PLV fermé, accès impossible...).
        Transmises hors du payload changes car elles ne correspondent pas
        à une création de donnée terrain.
        """
        if not echec_etapes:
            return
        Etape.objects.filter(
            uuid__in=[str(u) for u in echec_etapes],
            programme__utilisateur=self.user,
            is_deleted=False,
        ).update(statut_visite="ECHEC")

    def _sync_x3(self, pushed_op_uuids):
        """
        Simulation best-effort de la remontée vers Sage X3.
        Hors transaction, jamais bloquant : un échec ici n'annule pas le push.
        """
        if not pushed_op_uuids:
            return
        try:
            from mock_x3.x3_sync import creer_documents_x3
            ops = list(
                Operation.objects.filter(uuid__in=pushed_op_uuids)
                .select_related("etape__plv")
            )
            creer_documents_x3(ops)
        except Exception as exc:
            logger.warning("x3_sync echoue : %s", exc)

    @staticmethod
    def _to_point(d):
        """Convertit latitude/longitude en Point PostGIS (WGS84), ou None."""
        if d.get("latitude") is not None and d.get("longitude") is not None:
            return Point(d["longitude"], d["latitude"], srid=4326)
        return None
