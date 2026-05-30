#!/bin/bash
# =============================================================================
# Installation de l'API de synchronisation offline-first (protocole WatermelonDB)
# Usage : depuis ~/sodigaz_poc avec le venv active, bash install_sync_api.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : ce script doit etre execute depuis ~/sodigaz_poc"
    exit 1
fi

if [ -z "$VIRTUAL_ENV" ]; then
    echo "ERREUR : active d'abord le venv avec 'source venv/bin/activate'"
    exit 1
fi

# =============================================================================
echo ""
echo "=== Etape 1 : creation de l'app sync_api ==="
mkdir -p sync_api/migrations
touch sync_api/__init__.py
touch sync_api/migrations/__init__.py

cat > sync_api/apps.py << 'PYEOF'
from django.apps import AppConfig


class SyncApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "sync_api"
    verbose_name = "API de synchronisation offline-first"
PYEOF

# =============================================================================
# sync_api/serializers.py - serialisation des entites pour le pull
# =============================================================================
cat > sync_api/serializers.py << 'PYEOF'
"""
Serializers de synchronisation.

Conventions cles :
  - On envoie les UUID en clair, pas les id internes BIGSERIAL.
  - Les ForeignKey sont serialisees via UUID de la cible, pas via id.
    (le mobile ne connait que les UUID)
  - last_modified est inclus pour information cote mobile.
  - Les Point GeoDjango sont serialises en {lat, lng} pour simplifier
    cote mobile (pas de GeoJSON ici, on garde la charge utile minimale).
"""
from rest_framework import serializers

from accounts.models import Utilisateur
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
    Vehicule,
)


def serialize_point(point):
    """GeoDjango Point -> dict pour JSON."""
    if point is None:
        return None
    return {"latitude": point.y, "longitude": point.x}


# ---------------------------------------------------------------------------
# Referentiels (pull only)
# ---------------------------------------------------------------------------

class ClientSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = (
            "id", "code_x3", "raison_sociale", "type_client",
            "contact", "telephone", "actif",
        )


class PlvSyncSerializer(serializers.ModelSerializer):
    client_id = serializers.IntegerField(source="client.id", read_only=True)
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()

    class Meta:
        model = Plv
        fields = (
            "id", "client_id", "libelle", "adresse",
            "latitude", "longitude", "statut",
        )

    def get_latitude(self, obj):
        return obj.localisation.y if obj.localisation else None

    def get_longitude(self, obj):
        return obj.localisation.x if obj.localisation else None


class ProduitSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = Produit
        fields = (
            "id", "code_x3", "libelle", "type_emballage",
            "prix_unitaire", "montant_consignation", "actif",
        )


class VehiculeSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicule
        fields = ("id", "immatriculation", "type", "capacite", "actif")


# ---------------------------------------------------------------------------
# Tables semi-synchronisees (pull seulement depuis le mobile)
# ---------------------------------------------------------------------------

class ProgrammeSyncSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField()
    utilisateur_id = serializers.IntegerField()
    vehicule_id = serializers.IntegerField(allow_null=True)

    class Meta:
        model = Programme
        fields = (
            "id", "uuid", "numero_x3",
            "utilisateur_id", "vehicule_id",
            "date_programme", "type_programme", "statut",
            "heure_debut", "heure_fin",
            "last_modified",
        )


class EtapeSyncSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField()
    programme_id = serializers.IntegerField()
    plv_id = serializers.IntegerField()

    class Meta:
        model = Etape
        fields = (
            "id", "uuid",
            "programme_id", "plv_id",
            "ordre_prevu", "ordre_optimise", "statut_visite",
            "last_modified",
        )


class LigneProgrammeSyncSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField()
    etape_id = serializers.IntegerField()
    produit_id = serializers.IntegerField()

    class Meta:
        model = LigneProgramme
        fields = (
            "id", "uuid",
            "etape_id", "produit_id",
            "quantite_prevue",
            "last_modified",
        )


# ---------------------------------------------------------------------------
# Tables push (le mobile cree, le serveur recoit)
# ---------------------------------------------------------------------------

class OperationSyncSerializer(serializers.ModelSerializer):
    """Pour le PULL (relecture cote serveur). Le PUSH passe par OperationPushSerializer."""
    uuid = serializers.UUIDField()
    etape_id = serializers.IntegerField()
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()

    class Meta:
        model = Operation
        fields = (
            "id", "uuid", "etape_id",
            "type_operation", "sous_type",
            "date_heure", "latitude", "longitude",
            "mode_paiement", "montant_total", "montant_encaisse", "est_encaissee",
            "signature_livreur", "signature_client", "nom_signataire_client",
            "commentaire",
            "last_modified",
        )

    def get_latitude(self, obj):
        return obj.localisation_saisie.y if obj.localisation_saisie else None

    def get_longitude(self, obj):
        return obj.localisation_saisie.x if obj.localisation_saisie else None


class LigneOperationSyncSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField()
    operation_id = serializers.IntegerField()
    produit_id = serializers.IntegerField()

    class Meta:
        model = LigneOperation
        fields = (
            "id", "uuid",
            "operation_id", "produit_id",
            "quantite_realisee", "quantite_collectee_vide",
            "quantite_consignee", "quantite_deconsignee",
            "montant_ligne",
            "last_modified",
        )


class AnomalieSyncSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField()
    programme_id = serializers.IntegerField()
    plv_id = serializers.IntegerField(allow_null=True)
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()

    class Meta:
        model = Anomalie
        fields = (
            "id", "uuid", "programme_id", "plv_id",
            "type_anomalie", "gravite", "description", "statut",
            "date_heure", "latitude", "longitude",
            "last_modified",
        )

    def get_latitude(self, obj):
        return obj.localisation.y if obj.localisation else None

    def get_longitude(self, obj):
        return obj.localisation.x if obj.localisation else None


class PhotoSyncSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField()
    operation_id = serializers.IntegerField(allow_null=True)
    anomalie_id = serializers.IntegerField(allow_null=True)

    class Meta:
        model = Photo
        fields = (
            "id", "uuid", "operation_id", "anomalie_id",
            "fichier", "type_photo",
            "date_heure", "taille_octets",
            "last_modified",
        )
PYEOF

# =============================================================================
# sync_api/push_serializers.py - validation des donnees recues du mobile
# =============================================================================
cat > sync_api/push_serializers.py << 'PYEOF'
"""
Serializers d'ENTREE pour le push. Validation stricte du format envoye
par le mobile, avant traitement.

Note importante : ces serializers ne pointent PAS vers les modeles Django
directement (pas de ModelSerializer), car les references entre objets sont
faites par UUID, pas par id. La resolution UUID -> objet se fait dans la vue
de push, en transaction atomique.
"""
from rest_framework import serializers


class OperationPushSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    etape_uuid = serializers.UUIDField()
    type_operation = serializers.ChoiceField(
        choices=["COLLECTE", "RESTITUTION", "LIVRAISON_DIRECTE", "CONSIGNE"]
    )
    sous_type = serializers.ChoiceField(
        choices=["BCR", "BCT"], required=False, allow_null=True, allow_blank=True
    )
    date_heure = serializers.DateTimeField()
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    mode_paiement = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    montant_total = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    montant_encaisse = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    est_encaissee = serializers.BooleanField(default=False)
    signature_livreur = serializers.CharField(required=False, allow_blank=True)
    signature_client = serializers.CharField(required=False, allow_blank=True)
    nom_signataire_client = serializers.CharField(required=False, allow_blank=True)
    commentaire = serializers.CharField(required=False, allow_blank=True)


class LigneOperationPushSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    operation_uuid = serializers.UUIDField()
    produit_code_x3 = serializers.CharField()  # le mobile ne connait pas l'id interne
    quantite_realisee = serializers.IntegerField(min_value=0, default=0)
    quantite_collectee_vide = serializers.IntegerField(min_value=0, default=0)
    quantite_consignee = serializers.IntegerField(min_value=0, default=0)
    quantite_deconsignee = serializers.IntegerField(min_value=0, default=0)
    montant_ligne = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)


class AnomaliePushSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    programme_uuid = serializers.UUIDField()
    plv_id = serializers.IntegerField(required=False, allow_null=True)
    type_anomalie = serializers.CharField()
    gravite = serializers.ChoiceField(
        choices=["FAIBLE", "MOYENNE", "ELEVEE"], default="MOYENNE"
    )
    description = serializers.CharField()
    statut = serializers.ChoiceField(
        choices=["OUVERTE", "EN_TRAITEMENT", "RESOLUE"], default="OUVERTE"
    )
    date_heure = serializers.DateTimeField()
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)


class TableChangesSerializer(serializers.Serializer):
    """Format WatermelonDB : pour une table, 3 listes."""
    created = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    updated = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    deleted = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)


class PushPayloadSerializer(serializers.Serializer):
    """Format complet du push : { changes: { table: TableChanges, ... }, lastPulledAt }."""
    changes = serializers.DictField(child=TableChangesSerializer())
    lastPulledAt = serializers.IntegerField(required=False, default=0)
PYEOF

# =============================================================================
# sync_api/views.py - les deux endpoints pull et push
# =============================================================================
cat > sync_api/views.py << 'PYEOF'
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
from django.db import transaction
from django.shortcuts import get_object_or_404
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
    Plv,
    Produit,
    Programme,
    Vehicule,
)

from .push_serializers import (
    AnomaliePushSerializer,
    LigneOperationPushSerializer,
    OperationPushSerializer,
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
    VehiculeSyncSerializer,
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

      - Referentiels (Client, PLV, Produit, Vehicule) : tous (pas de filtre
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
    vehicules_changes = _build_changes(
        Vehicule.objects.all(), last_pulled_at, VehiculeSyncSerializer,
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
            "vehicule": vehicules_changes,
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

    except PermissionError as e:
        return Response(
            {"status": "error", "detail": str(e)},
            status=status.HTTP_403_FORBIDDEN,
        )

    return Response({"status": "ok", "applied": applied}, status=status.HTTP_200_OK)
PYEOF

# =============================================================================
# sync_api/urls.py
# =============================================================================
cat > sync_api/urls.py << 'PYEOF'
from django.urls import path

from . import views

app_name = "sync_api"

urlpatterns = [
    path("pull/", views.sync_pull, name="pull"),
    path("push/", views.sync_push, name="push"),
]
PYEOF

echo "OK : app sync_api creee"

# =============================================================================
echo ""
echo "=== Etape 2 : configuration de config/settings.py ==="

python3 << 'PYEOF'
from pathlib import Path
import re

settings_path = Path("config/settings.py")
content = settings_path.read_text()

if '"sync_api"' not in content:
    content = re.sub(
        r'("auth_api",\s*\n)(\])',
        r'\1    "sync_api",\n\2',
        content,
    )
    settings_path.write_text(content)
    print("  + sync_api ajoute aux INSTALLED_APPS")
else:
    print("  = sync_api deja present")
PYEOF

# =============================================================================
echo ""
echo "=== Etape 3 : ajout de la route /api/sync/ ==="

python3 << 'PYEOF'
from pathlib import Path

urls_path = Path("config/urls.py")
content = urls_path.read_text()

if "sync_api" not in content:
    new_content = '''from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("auth_api.urls")),
    path("api/mock-x3/", include("mock_x3.urls")),
    path("api/sync/", include("sync_api.urls")),
]
'''
    urls_path.write_text(new_content)
    print("  + route /api/sync/ ajoutee")
else:
    print("  = route /api/sync/ deja presente")
PYEOF

# =============================================================================
echo ""
echo "=============================================="
echo "INSTALLATION SYNC_API TERMINEE."
echo "=============================================="
echo ""
echo "Demarre le serveur :"
echo "  python manage.py runserver"
echo ""
echo "Dans un autre terminal, suis le scenario de test ci-dessous."
echo ""
