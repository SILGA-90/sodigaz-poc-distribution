"""
Serializers d'entrée pour le push (validation des données envoyées par le mobile).

Ce module définit les serializers utilisés pour valider le payload JSON
reçu lors d'un push (POST /api/sync/push/ et /api/sync/photos/<uuid>/upload/).
Ils ne pointent PAS vers les modèles Django directement (pas de
ModelSerializer) : les références inter-objets sont faites par UUID, et
la résolution UUID -> objet Django se fait dans la vue push (sync_api/views.py),
au sein d'une transaction atomique.

Le mobile connaît les UUID, pas
les id internes PostgreSQL. Un ModelSerializer attendrait un objet Django
déjà chargé pour les FK. Ici, on valide d'abord le format (présence des
champs, types, choix valides), puis la vue fait la résolution en DB.

Toutes les données terrain viennent d'appareils
non maîtrisés (téléphones des livreurs). Une validation stricte à l'entrée
garantit que la vue push peut travailler avec des données propres et
déclencher des exceptions explicites en cas de problème.

Format du payload de push (PushPayloadSerializer) :
    {
        "changes": {
            "operation":       { "created": [...], "updated": [...], "deleted": [...] },
            "ligne_operation": { ... },
            "anomalie":        { ... },
            "photo":           { ... },
        },
        "lastPulledAt": <timestamp ms>,
        "echec_etapes": ["<uuid>", ...]
    }
"""
from rest_framework import serializers


class OperationPushSerializer(serializers.Serializer):
    """
    Valide une opération terrain (COLLECTE, RESTITUTION, etc.) reçue du mobile.
    sous_type (BCR/BCT) n'est renseigné que pour les
         COLLECTE. La cohérence est vérifiée par la CheckConstraint SQL dans
         Operation.Meta, pas ici (séparation des responsabilités).
    Deux champs qualifiant le fix GPS :
         précision en mètres et moment du fix (peut précéder la saisie). Permettent
         au superviseur d'évaluer la fiabilité de la localisation.
    """
    uuid                  = serializers.UUIDField()
    etape_uuid            = serializers.UUIDField()
    type_operation        = serializers.ChoiceField(
        choices=["COLLECTE", "RESTITUTION", "LIVRAISON_DIRECTE", "CONSIGNE"]
    )
    sous_type             = serializers.ChoiceField(
        choices=["BCR", "BCT"], required=False, allow_null=True, allow_blank=True
    )
    date_heure            = serializers.DateTimeField()
    latitude              = serializers.FloatField(required=False, allow_null=True)
    longitude             = serializers.FloatField(required=False, allow_null=True)
    gps_precision         = serializers.FloatField(required=False, allow_null=True)
    gps_horodatage        = serializers.DateTimeField(required=False, allow_null=True)
    mode_paiement         = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    montant_total         = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    montant_encaisse      = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    est_encaissee         = serializers.BooleanField(default=False)
    signature_livreur     = serializers.CharField(required=False, allow_blank=True)
    signature_client      = serializers.CharField(required=False, allow_blank=True)
    nom_signataire_client = serializers.CharField(required=False, allow_blank=True)
    commentaire           = serializers.CharField(required=False, allow_blank=True)


class LigneOperationPushSerializer(serializers.Serializer):
    """
    Valide une ligne de détail d'opération (quantité réalisée par article).
    Le mobile ne connaît pas l'id interne
         de l'article : il utilise le code X3 comme clé métier (stable et lisible).
         La résolution code_x3 -> Article.id se fait dans la vue push.
    """
    uuid                     = serializers.UUIDField()
    operation_uuid           = serializers.UUIDField()
    produit_code_x3          = serializers.CharField()
    quantite_realisee        = serializers.IntegerField(min_value=0, default=0)
    quantite_collectee_vide  = serializers.IntegerField(min_value=0, default=0)
    quantite_consignee       = serializers.IntegerField(min_value=0, default=0)
    quantite_deconsignee     = serializers.IntegerField(min_value=0, default=0)
    montant_ligne            = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)


class AnomaliePushSerializer(serializers.Serializer):
    """
    Valide une anomalie terrain envoyée par le mobile.
    Même logique que les autres
         serializers : le mobile travaille avec des UUID.
    """
    uuid          = serializers.UUIDField()
    programme_uuid = serializers.UUIDField()
    plv_id        = serializers.IntegerField(required=False, allow_null=True)
    type_anomalie = serializers.CharField()
    gravite       = serializers.ChoiceField(
        choices=["FAIBLE", "MOYENNE", "ELEVEE"], default="MOYENNE"
    )
    description   = serializers.CharField()
    statut        = serializers.ChoiceField(
        choices=["OUVERTE", "EN_TRAITEMENT", "RESOLUE"], default="OUVERTE"
    )
    date_heure = serializers.DateTimeField()
    latitude   = serializers.FloatField(required=False, allow_null=True)
    longitude  = serializers.FloatField(required=False, allow_null=True)


class TableChangesSerializer(serializers.Serializer):
    """
    Format WatermelonDB pour les changements d'une table :
    { created: [...], updated: [...], deleted: [...] }.
    Notre protocole s'inspire du format WatermelonDB pour la lisibilité
    et la symétrie push/pull, même si l'implémentation est maison.
    """
    created = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    updated = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    deleted = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)


class PushPayloadSerializer(serializers.Serializer):
    """
    Enveloppe complète du push : { changes, lastPulledAt, echec_etapes }.
    Permet au serveur de détecter des conflits
         éventuels (un objet modifié côté serveur après le dernier pull du mobile).
         Pour ce POC, on applique last-write-wins : ce champ est enregistré pour
         traçabilité mais ne bloque pas le push.
    Liste d'UUIDs d'étapes que le livreur a marquées ECHEC
         (PLV inaccessible, client absent...). Le serveur met à jour statut_visite=ECHEC
         sur ces étapes.
    """
    changes      = serializers.DictField(child=TableChangesSerializer())
    lastPulledAt = serializers.IntegerField(required=False, default=0)
    echec_etapes = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )


class PhotoPushSerializer(serializers.Serializer):
    """
    Valide les métadonnées d'une Photo (premier appel, sans le fichier).
    Le fichier binaire est envoyé séparément via POST /api/sync/photos/<uuid>/upload/.

    Séparer les métadonnées du fichier permet :
         1. D'enregistrer la photo en base dès le premier appel (on sait qu'elle
            existe), même si l'upload du fichier échoue (réseau instable).
         2. De reprendre l'upload du fichier sans recréer l'enregistrement.
         3. De traiter les photos comme des entités ordinaires dans le push.

    Une photo appartient
         soit à une opération, soit à une anomalie. La méthode validate() lève
         une erreur si les deux sont renseignés ou aucun.
    """
    uuid           = serializers.UUIDField()
    operation_uuid = serializers.UUIDField(required=False, allow_null=True)
    anomalie_uuid  = serializers.UUIDField(required=False, allow_null=True)
    type_photo     = serializers.ChoiceField(
        choices=["BORDEREAU", "LIVRAISON", "ETAT_PLV", "ANOMALIE"]
    )
    date_heure     = serializers.DateTimeField()
    latitude       = serializers.FloatField(required=False, allow_null=True)
    longitude      = serializers.FloatField(required=False, allow_null=True)
    taille_octets  = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        op = attrs.get("operation_uuid")
        an = attrs.get("anomalie_uuid")
        if bool(op) == bool(an):
            raise serializers.ValidationError(
                "Une photo doit être rattachée soit à une opération, soit "
                "à une anomalie, mais pas aux deux."
            )
        return attrs
