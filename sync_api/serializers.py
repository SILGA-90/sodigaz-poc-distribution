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
    etape_uuid = serializers.SerializerMethodField()
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()

    class Meta:
        model = Operation
        fields = (
            "id", "uuid", "etape_uuid",
            "type_operation", "sous_type",
            "date_heure", "latitude", "longitude",
            "mode_paiement", "montant_total", "montant_encaisse", "est_encaissee",
            "signature_livreur", "signature_client", "nom_signataire_client",
            "commentaire",
            "last_modified",
        )

    def get_etape_uuid(self, obj):
        return str(obj.etape.uuid) if obj.etape_id else None

    def get_latitude(self, obj):
        return obj.localisation_saisie.y if obj.localisation_saisie else None

    def get_longitude(self, obj):
        return obj.localisation_saisie.x if obj.localisation_saisie else None


class LigneOperationSyncSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField()
    operation_uuid = serializers.SerializerMethodField()
    produit_code_x3 = serializers.SerializerMethodField()

    class Meta:
        model = LigneOperation
        fields = (
            "id", "uuid",
            "operation_uuid", "produit_code_x3",
            "quantite_realisee", "quantite_collectee_vide",
            "quantite_consignee", "quantite_deconsignee",
            "montant_ligne",
            "last_modified",
        )

    def get_operation_uuid(self, obj):
        return str(obj.operation.uuid) if obj.operation_id else None

    def get_produit_code_x3(self, obj):
        return obj.produit.code_x3 if obj.produit_id else None


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
