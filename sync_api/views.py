"""
Endpoints de synchronisation offline-first (protocole WatermelonDB).

POST /api/sync/pull
    Corps :    { "lastPulledAt": <timestamp_ms> }
    Reponse :  { "changes": { ... }, "timestamp": <timestamp_ms> }

POST /api/sync/push
    Corps :    { "changes": { ... }, "lastPulledAt": <timestamp_ms> }
    Reponse :  { "status": "ok", "applied": { ... } }

Authentification : JWT. Le livreur connecte est identifie par request.user.
Filtre de securite : un livreur ne voit / ne pousse QUE ses propres donnees.
"""
import time
from contextlib import suppress

from django.contrib.gis.geos import Point
from django.db import models, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import Role
from distribution.models import (
    Anomalie,
    Client,
    Etape,
    LigneOperation,
    LigneProgramme,
    Operation,
    Photo,
    Plv,
    Produit,
    Programme,
)

from .push_serializers import (
    AnomaliePushSerializer,
    LigneOperationPushSerializer,
    OperationPushSerializer,
    PhotoPushSerializer,
    PushPayloadSerializer,
)
from .serializers import (
    AnomalieSyncSerializer,
    ClientSyncSerializer,
    EtapeSyncSerializer,
    LigneOperationSyncSerializer,
    LigneProgrammeSyncSerializer,
    OperationSyncSerializer,
    PlvSyncSerializer,
    ProduitSyncSerializer,
    ProgrammeSyncSerializer,
)


def now_ms() -> int:
    """Timestamp courant en millisecondes (format WatermelonDB)."""
    return int(time.time() * 1000)


# ===========================================================================
# PULL
# ===========================================================================

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sync_pull(request):
    """
    Renvoie tous les changements survenus cote serveur depuis lastPulledAt
    pour le livreur connecte.

    Hierarchie du filtrage par livreur :
      - Programmes : ceux dont utilisateur == request.user
      - Etapes : celles des programmes ci-dessus
      - LigneProgramme : celles des etapes ci-dessus
      - Operations, LigneOperation, Photo : idem en remontant la chaine
      - Anomalies : celles des programmes ci-dessus

      - Referentiels (Client, PLV, Produit) : tous (pas de filtre
        livreur sur les referentiels, ils sont partages).
    """
    last_pulled_at = request.data.get("lastPulledAt", 0) or 0
    user = request.user

    # Timestamp courant cote serveur, retourne en fin de reponse.
    server_timestamp = now_ms()

    # Ensemble des programmes du livreur connecte (servira de filtre pour
    # toutes les tables qui en derivent).
    programmes_qs = Programme.objects.filter(utilisateur=user)
    programmes_ids = list(programmes_qs.values_list("id", flat=True))

    # --------------------------------------------------------------------
    # Referentiels (pas de filtre par livreur)
    # --------------------------------------------------------------------
    clients_changes = _build_changes(
        Client.objects.all(), last_pulled_at, ClientSyncSerializer,
        has_soft_delete=False, has_last_modified=False,
    )
    plvs_changes = _build_changes(
        Plv.objects.all(), last_pulled_at, PlvSyncSerializer,
        has_soft_delete=False, has_last_modified=False,
    )
    produits_changes = _build_changes(
        Produit.objects.all(), last_pulled_at, ProduitSyncSerializer,
        has_soft_delete=False, has_last_modified=False,
    )

    # --------------------------------------------------------------------
    # Programmes du livreur
    # --------------------------------------------------------------------
    programmes_changes = _build_changes(
        programmes_qs, last_pulled_at, ProgrammeSyncSerializer,
    )

    # --------------------------------------------------------------------
    # Etapes des programmes du livreur
    # --------------------------------------------------------------------
    etapes_qs = Etape.objects.filter(programme_id__in=programmes_ids)
    etapes_changes = _build_changes(etapes_qs, last_pulled_at, EtapeSyncSerializer)

    # --------------------------------------------------------------------
    # Lignes prevues des etapes du livreur
    # --------------------------------------------------------------------
    etapes_ids = list(etapes_qs.values_list("id", flat=True))
    lignes_prog_qs = LigneProgramme.objects.filter(etape_id__in=etapes_ids)
    lignes_prog_changes = _build_changes(
        lignes_prog_qs, last_pulled_at, LigneProgrammeSyncSerializer,
    )

    # --------------------------------------------------------------------
    # Operations / lignes_operation / anomalies du livreur
    # (re-pull au cas ou serveur les aurait modifies, ex : superviseur)
    # --------------------------------------------------------------------
    operations_qs = Operation.objects.filter(etape_id__in=etapes_ids)
    operations_changes = _build_changes(
        operations_qs, last_pulled_at, OperationSyncSerializer,
    )
    operations_ids = list(operations_qs.values_list("id", flat=True))

    lignes_op_qs = LigneOperation.objects.filter(operation_id__in=operations_ids)
    lignes_op_changes = _build_changes(
        lignes_op_qs, last_pulled_at, LigneOperationSyncSerializer,
    )

    anomalies_qs = Anomalie.objects.filter(programme_id__in=programmes_ids)
    anomalies_changes = _build_changes(
        anomalies_qs, last_pulled_at, AnomalieSyncSerializer,
    )

    return Response({
        "changes": {
            "client": clients_changes,
            "plv": plvs_changes,
            "produit": produits_changes,
            "programme": programmes_changes,
            "etape": etapes_changes,
            "ligne_programme": lignes_prog_changes,
            "operation": operations_changes,
            "ligne_operation": lignes_op_changes,
            "anomalie": anomalies_changes,
        },
        "timestamp": server_timestamp,
    })


def _build_changes(queryset, last_pulled_at, serializer_class,
                   has_soft_delete=True, has_last_modified=True):
    """
    Construit le dict { created, updated, deleted } pour une table.

    Note : la distinction created/updated n'est pas requise par WatermelonDB
    cote client (les deux sont traites identiquement). On met tout dans
    'updated' pour simplifier.
    """
    if has_last_modified:
        qs = queryset.filter(last_modified__gt=last_pulled_at)
    else:
        # Pour les tables sans last_modified (referentiels), on renvoie tout
        # lors du tout premier pull (last_pulled_at == 0), et rien ensuite.
        # En production, on ajouterait un timestamp manuel ; pour le POC c'est
        # acceptable.
        if last_pulled_at == 0:
            qs = queryset
        else:
            qs = queryset.none()

    if has_soft_delete:
        active_qs = qs.filter(is_deleted=False)
        deleted_qs = qs.filter(is_deleted=True)
        deleted_uuids = list(deleted_qs.values_list("uuid", flat=True))
    else:
        active_qs = qs
        deleted_uuids = []

    serialized = serializer_class(active_qs, many=True).data

    return {
        "created": [],
        "updated": serialized,
        "deleted": [str(u) for u in deleted_uuids],
    }


# ===========================================================================
# PUSH
# ===========================================================================

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sync_push(request):
    """
    Recoit les changements effectues hors ligne par le livreur et les applique.

    Le payload regroupe par table. On traite dans l'ordre :
      1. Operations (parent des lignes_operation et photos)
      2. Lignes_operation
      3. Anomalies
      4. Photos
    Cet ordre garantit que les parents existent avant les enfants.

    Toute l'operation est dans une transaction atomique : en cas d'erreur,
    aucun changement n'est applique, le client retentera.
    """
    serializer = PushPayloadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    changes = serializer.validated_data["changes"]
    user = request.user

    # Securite : verifier que le livreur connecte n'agit que sur SES propres
    # programmes. On precharge les UUID de programmes / etapes / operations
    # autorises.
    programmes_user_uuids = set(
        str(u) for u in Programme.objects.filter(utilisateur=user).values_list("uuid", flat=True)
    )
    etapes_user_ids_by_uuid = {
        str(e.uuid): e.id for e in
        Etape.objects.filter(programme__utilisateur=user).only("id", "uuid")
    }

    applied = {
        "operation": {"created": 0, "updated": 0, "deleted": 0},
        "ligne_operation": {"created": 0, "updated": 0, "deleted": 0},
        "anomalie": {"created": 0, "updated": 0, "deleted": 0},
        "photo": {"created": 0, "updated": 0, "deleted": 0},
    }

    try:
        with transaction.atomic():
            # ----- OPERATIONS -----
            for op_data in (
                changes.get("operation", {}).get("created", [])
                + changes.get("operation", {}).get("updated", [])
            ):
                op_serializer = OperationPushSerializer(data=op_data)
                op_serializer.is_valid(raise_exception=True)
                d = op_serializer.validated_data

                etape_id = etapes_user_ids_by_uuid.get(str(d["etape_uuid"]))
                if etape_id is None:
                    raise PermissionError(
                        f"Etape {d['etape_uuid']} introuvable ou non autorisee."
                    )

                localisation = None
                if d.get("latitude") is not None and d.get("longitude") is not None:
                    localisation = Point(d["longitude"], d["latitude"], srid=4326)

                op, created = Operation.objects.update_or_create(
                    uuid=d["uuid"],
                    defaults={
                        "etape_id": etape_id,
                        "type_operation": d["type_operation"],
                        "sous_type": d.get("sous_type") or None,
                        "date_heure": d["date_heure"],
                        "localisation_saisie": localisation,
                        "mode_paiement": d.get("mode_paiement") or None,
                        "montant_total": d["montant_total"],
                        "montant_encaisse": d["montant_encaisse"],
                        "est_encaissee": d["est_encaissee"],
                        "signature_livreur": d.get("signature_livreur", ""),
                        "signature_client": d.get("signature_client", ""),
                        "nom_signataire_client": d.get("nom_signataire_client", ""),
                        "commentaire": d.get("commentaire", ""),
                        "gps_precision": d.get("gps_precision"),
                        "gps_horodatage": d.get("gps_horodatage"),
                        "is_deleted": False,
                    },
                )
                key = "created" if created else "updated"
                applied["operation"][key] += 1

            # Suppressions logiques d'operations
            for uuid_to_delete in changes.get("operation", {}).get("deleted", []):
                updated = Operation.objects.filter(
                    uuid=uuid_to_delete,
                    etape__programme__utilisateur=user,  # securite
                ).update(is_deleted=True)
                applied["operation"]["deleted"] += updated

            # ----- LIGNES D'OPERATION -----
            for ligne_data in (
                changes.get("ligne_operation", {}).get("created", [])
                + changes.get("ligne_operation", {}).get("updated", [])
            ):
                lo_serializer = LigneOperationPushSerializer(data=ligne_data)
                lo_serializer.is_valid(raise_exception=True)
                d = lo_serializer.validated_data

                operation = Operation.objects.filter(
                    uuid=d["operation_uuid"],
                    etape__programme__utilisateur=user,
                ).first()
                if operation is None:
                    raise PermissionError(
                        f"Operation {d['operation_uuid']} introuvable ou non autorisee."
                    )

                produit = get_object_or_404(Produit, code_x3=d["produit_code_x3"])

                _, created = LigneOperation.objects.update_or_create(
                    uuid=d["uuid"],
                    defaults={
                        "operation_id": operation.id,
                        "produit_id": produit.id,
                        "quantite_realisee": d["quantite_realisee"],
                        "quantite_collectee_vide": d["quantite_collectee_vide"],
                        "quantite_consignee": d["quantite_consignee"],
                        "quantite_deconsignee": d["quantite_deconsignee"],
                        "montant_ligne": d["montant_ligne"],
                        "is_deleted": False,
                    },
                )
                key = "created" if created else "updated"
                applied["ligne_operation"][key] += 1

            for uuid_to_delete in changes.get("ligne_operation", {}).get("deleted", []):
                updated = LigneOperation.objects.filter(
                    uuid=uuid_to_delete,
                    operation__etape__programme__utilisateur=user,
                ).update(is_deleted=True)
                applied["ligne_operation"]["deleted"] += updated

            # ----- ANOMALIES -----
            for ano_data in (
                changes.get("anomalie", {}).get("created", [])
                + changes.get("anomalie", {}).get("updated", [])
            ):
                an_serializer = AnomaliePushSerializer(data=ano_data)
                an_serializer.is_valid(raise_exception=True)
                d = an_serializer.validated_data

                programme = Programme.objects.filter(
                    uuid=d["programme_uuid"],
                    utilisateur=user,
                ).first()
                if programme is None:
                    raise PermissionError(
                        f"Programme {d['programme_uuid']} introuvable ou non autorise."
                    )

                localisation = None
                if d.get("latitude") is not None and d.get("longitude") is not None:
                    localisation = Point(d["longitude"], d["latitude"], srid=4326)

                _, created = Anomalie.objects.update_or_create(
                    uuid=d["uuid"],
                    defaults={
                        "programme_id": programme.id,
                        "plv_id": d.get("plv_id"),
                        "type_anomalie": d["type_anomalie"],
                        "gravite": d["gravite"],
                        "description": d["description"],
                        "statut": d["statut"],
                        "date_heure": d["date_heure"],
                        "localisation": localisation,
                        "is_deleted": False,
                    },
                )
                key = "created" if created else "updated"
                applied["anomalie"][key] += 1

            for uuid_to_delete in changes.get("anomalie", {}).get("deleted", []):
                updated = Anomalie.objects.filter(
                    uuid=uuid_to_delete,
                    programme__utilisateur=user,
                ).update(is_deleted=True)
                applied["anomalie"]["deleted"] += updated


            # ----- PHOTOS (metadonnees uniquement, fichier binaire upload separement) -----
            for photo_data in (
                changes.get("photo", {}).get("created", [])
                + changes.get("photo", {}).get("updated", [])
            ):
                ph_serializer = PhotoPushSerializer(data=photo_data)
                ph_serializer.is_valid(raise_exception=True)
                d = ph_serializer.validated_data

                operation_id = None
                anomalie_id = None
                if d.get("operation_uuid"):
                    op = Operation.objects.filter(
                        uuid=d["operation_uuid"],
                        etape__programme__utilisateur=user,
                    ).first()
                    if op is None:
                        raise PermissionError(
                            f"Operation {d['operation_uuid']} introuvable ou non autorisee."
                        )
                    operation_id = op.id
                else:
                    an = Anomalie.objects.filter(
                        uuid=d["anomalie_uuid"],
                        programme__utilisateur=user,
                    ).first()
                    if an is None:
                        raise PermissionError(
                            f"Anomalie {d['anomalie_uuid']} introuvable ou non autorisee."
                        )
                    anomalie_id = an.id

                # update_or_create : le fichier reste vide pour l'instant,
                # il sera renseigne par l'endpoint d'upload binaire dedie.
                # On preserve un eventuel fichier deja upload (par un cycle precedent).
                existing = Photo.objects.filter(uuid=d["uuid"]).first()
                defaults = {
                    "operation_id": operation_id,
                    "anomalie_id": anomalie_id,
                    "type_photo": d["type_photo"],
                    "date_heure": d["date_heure"],
                    "taille_octets": d.get("taille_octets"),
                    "is_deleted": False,
                }
                if d.get("latitude") is not None and d.get("longitude") is not None:
                    defaults["localisation"] = Point(d["longitude"], d["latitude"], srid=4326)

                if existing:
                    for k, v in defaults.items():
                        setattr(existing, k, v)
                    existing.save()
                    applied["photo"]["updated"] += 1
                else:
                    # fichier est requis par le modele (ImageField sans null=True),
                    # on cree un nom de placeholder le temps que l'upload arrive.
                    Photo.objects.create(uuid=d["uuid"], fichier="placeholder.bin", **defaults)
                    applied["photo"]["created"] += 1

            for uuid_to_delete in changes.get("photo", {}).get("deleted", []):
                # On filtre sur le user via la chaine soit operation, soit anomalie
                photos = Photo.objects.filter(uuid=uuid_to_delete).filter(
                    models.Q(operation__etape__programme__utilisateur=user)
                    | models.Q(anomalie__programme__utilisateur=user)
                )
                updated = photos.update(is_deleted=True)
                applied["photo"]["deleted"] += updated

    except PermissionError as e:
        return Response(
            {"status": "error", "detail": str(e)},
            status=status.HTTP_403_FORBIDDEN,
        )

    return Response({"status": "ok", "applied": applied}, status=status.HTTP_200_OK)


# ===========================================================================
# UPLOAD DU FICHIER BINAIRE D'UNE PHOTO
# ===========================================================================

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_photo(request, uuid):
    """
    Upload du fichier binaire d'une photo dont l'enregistrement existe deja
    cote serveur (cree au prealable via sync_push).

    URL : POST /api/sync/photos/<uuid>/upload/
    Body : multipart/form-data, champ 'fichier'

    Le livreur ne peut uploader que sur ses propres photos.
    """
    if "fichier" not in request.FILES:
        return Response(
            {"detail": "Champ 'fichier' manquant dans le multipart."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Recherche de la photo, en filtrant par autorisation utilisateur
    photo = Photo.objects.filter(uuid=uuid).filter(
        models.Q(operation__etape__programme__utilisateur=request.user)
        | models.Q(anomalie__programme__utilisateur=request.user)
    ).first()

    if photo is None:
        return Response(
            {"detail": "Photo introuvable ou non autorisee."},
            status=status.HTTP_404_NOT_FOUND,
        )

    fichier = request.FILES["fichier"]
    photo.fichier = fichier
    photo.taille_octets = fichier.size
    photo.save()

    return Response({
        "status": "ok",
        "uuid": str(photo.uuid),
        "url": request.build_absolute_uri(photo.fichier.url),
        "taille_octets": photo.taille_octets,
    }, status=status.HTTP_200_OK)


# ===========================================================================
# CLOTURE DE PROGRAMMES
# ===========================================================================

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cloturer_programmes(request):
    """
    Cloture un ou plusieurs programmes du livreur connecte.

    URL  : POST /api/sync/programmes/cloturer/
    Body : { "uuids": ["<uuid1>", "<uuid2>", ...] }

    Le statut passe a CLOTURE et l'heure de fin est horodatee cote serveur
    (evite tout probleme de format de date entre mobile et serveur).
    Filtre de securite : un livreur ne peut cloturer que SES programmes.
    """
    uuids = request.data.get("uuids", [])
    if not isinstance(uuids, list):
        return Response(
            {"status": "error", "detail": "Le champ 'uuids' doit etre une liste."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    heure_fin = timezone.now()
    count = 0
    for u in uuids:
        count += Programme.objects.filter(
            uuid=u, utilisateur=request.user, is_deleted=False,
        ).update(statut="CLOTURE", heure_fin=heure_fin)

    return Response({"status": "ok", "clotures": count}, status=status.HTTP_200_OK)
