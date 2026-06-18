"""
Serializers de synchronisation (lecture/pull).

Ce module définit les serializers utilisés pour formater les données
envoyées au mobile lors d'un pull (GET /api/sync/pull/). Chaque classe
correspond à une table du schéma de synchronisation.

       Trois groupes :
       1. Référentiels (pull only) : Client, Plv, Article, Vehicule
       2. Semi-synchronisés (pull) : Programme, Etape, LigneProgramme
       3. Push (données terrain)   : Operation, LigneOperation, Anomalie, Photo
          -> pour la lecture inverse seulement ; le push entrant passe par
            push_serializers.py.

Le mobile ne connaît pas les id BIGSERIAL
de la base PostgreSQL : ils n'ont pas de sens hors du serveur. Toute
référence entre objets (ex. etape_uuid dans une opération) passe par UUID.
Cela permet aussi à la base de données de changer ses auto-incréments
(ex. après un reset seed) sans invalider les données mobiles.

Les référentiels
(Client, Plv, Article) sont identifiés par id entier côté mobile SQLite
car ils n'ont pas de UUID : ce sont des données maîtres sans cycle de vie
synchronisé. Les tables du bloc 2 et 3 utilisent les UUID pour les FK.

Le mobile n'utilise pas de bibliothèque
cartographique (décision architecturale : voir CLAUDE.md). Un dict
{latitude, longitude} est plus simple à lire et écrire dans SQLite qu'un
Feature GeoJSON. La charge utile est aussi plus légère.
"""
from rest_framework import serializers

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
    Vehicule,
)


def serialize_point(point):
    """
    Convertit un PointField GeoDjango en dict {latitude, longitude}.
    Voir module docstring : {lat, lng} est plus simple que GeoJSON pour
    un client SQLite sans bibliothèque cartographique.
    """
    if point is None:
        return None
    return {"latitude": point.y, "longitude": point.x}


# ---------------------------------------------------------------------------
# 1. Référentiels (pull only)
# ---------------------------------------------------------------------------

class ClientSyncSerializer(serializers.ModelSerializer):
    """WHAT : Sérialise un Client pour le pull. Identifié par id entier (pas d'UUID)."""
    class Meta:
        model = Client
        fields = (
            "id", "code_x3", "raison_sociale", "type_client",
            "contact", "telephone", "actif",
        )


class PlvSyncSerializer(serializers.ModelSerializer):
    """
    Sérialise un PLV pour le pull, avec latitude/longitude à plat.
    Évite d'imbriquer serialize_point() dans
         un sous-objet : le mobile peut lire directement les deux champs.
    """
    client_id = serializers.IntegerField(source="client.id", read_only=True)
    latitude  = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()

    class Meta:
        model = Plv
        fields = (
            "id", "client_id", "code_plv", "libelle", "adresse",
            "latitude", "longitude", "statut",
        )

    def get_latitude(self, obj):
        return obj.localisation.y if obj.localisation else None

    def get_longitude(self, obj):
        return obj.localisation.x if obj.localisation else None


class ArticleSyncSerializer(serializers.ModelSerializer):
    """WHAT : Sérialise un Article pour le pull. Identifié par id entier + code_x3."""
    class Meta:
        model = Article
        fields = (
            "id", "code_x3", "libelle", "type_emballage",
            "prix_unitaire", "montant_consignation", "actif",
        )


class VehiculeSyncSerializer(serializers.ModelSerializer):
    """WHAT : Sérialise un Véhicule pour le pull."""
    class Meta:
        model = Vehicule
        fields = ("id", "immatriculation", "type", "capacite", "actif")


# ---------------------------------------------------------------------------
# 2. Tables semi-synchronisées (pull seulement depuis le mobile)
# ---------------------------------------------------------------------------

class ProgrammeSyncSerializer(serializers.ModelSerializer):
    """
    Sérialise un Programme pour le pull incrémental.
    Le mobile utilise ce champ pour savoir si
         l'enregistrement local doit être mis à jour (INSERT OR REPLACE).
         Sans last_modified, tout pull écraserait les données locales même
         si rien n'a changé.
    """
    uuid           = serializers.UUIDField()
    utilisateur_id = serializers.IntegerField()
    vehicule_id    = serializers.IntegerField(allow_null=True)

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
    """
    Sérialise une Etape pour le pull incrémental.
    Le mobile affiche l'ordre optimisé au livreur
         dans l'écran de liste des étapes.
    """
    uuid         = serializers.UUIDField()
    programme_id = serializers.IntegerField()
    plv_id       = serializers.IntegerField()

    class Meta:
        model = Etape
        fields = (
            "id", "uuid",
            "programme_id", "plv_id",
            "ordre_prevu", "ordre_optimise", "statut_visite",
            "last_modified",
        )


class LigneProgrammeSyncSerializer(serializers.ModelSerializer):
    """
    Sérialise une LigneProgramme (quantité prévue) pour le pull.
    Le mobile joint LigneProgramme à la table article
         via l'id entier : cohérent avec ArticleSyncSerializer.
    """
    uuid     = serializers.UUIDField()
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
# 3. Tables push (données créées sur le mobile, lues en retour si nécessaire)
# ---------------------------------------------------------------------------

class OperationSyncSerializer(serializers.ModelSerializer):
    """
    Sérialise une Opération pour la lecture (pull ou réponse de push).
    Le mobile référence les étapes par
         UUID, jamais par id interne. La méthode get_etape_uuid() traverse la FK.
    """
    uuid       = serializers.UUIDField()
    etape_uuid = serializers.SerializerMethodField()
    latitude   = serializers.SerializerMethodField()
    longitude  = serializers.SerializerMethodField()

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
    """
    Sérialise une LigneOperation (quantité réalisée) pour la lecture.
    La LigneProgramme utilise
         l'id entier de l'article ; mais pour LigneOperation (donnée terrain),
         le mobile pousse avec produit_code_x3 et relit avec le même champ pour
         cohérence.
    """
    uuid            = serializers.UUIDField()
    operation_uuid  = serializers.SerializerMethodField()
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
    """WHAT : Sérialise une Anomalie pour la lecture (pull)."""
    uuid        = serializers.UUIDField()
    programme_id = serializers.IntegerField()
    plv_id      = serializers.IntegerField(allow_null=True)
    latitude    = serializers.SerializerMethodField()
    longitude   = serializers.SerializerMethodField()

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
    """
    Sérialise une Photo pour la lecture (pull).
    Le superviseur peut consulter les photos depuis
         l'interface web ; le champ fichier est l'URL relative du fichier uploadé.
    """
    uuid         = serializers.UUIDField()
    operation_id = serializers.IntegerField(allow_null=True)
    anomalie_id  = serializers.IntegerField(allow_null=True)

    class Meta:
        model = Photo
        fields = (
            "id", "uuid", "operation_id", "anomalie_id",
            "fichier", "type_photo",
            "date_heure", "taille_octets",
            "last_modified",
        )
