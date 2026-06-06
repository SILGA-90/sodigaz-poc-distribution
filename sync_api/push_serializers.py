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
    gps_precision = serializers.FloatField(required=False, allow_null=True)
    gps_horodatage = serializers.DateTimeField(required=False, allow_null=True)
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
    echec_etapes = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )


class PhotoPushSerializer(serializers.Serializer):
    """
    Pour le push JSON de l'enregistrement Photo (metadonnees uniquement).
    Le fichier binaire est upload separement via POST /api/sync/photos/<uuid>/upload.

    Contrainte : operation_uuid OU anomalie_uuid renseigne, jamais les deux.
    """
    uuid = serializers.UUIDField()
    operation_uuid = serializers.UUIDField(required=False, allow_null=True)
    anomalie_uuid = serializers.UUIDField(required=False, allow_null=True)
    type_photo = serializers.ChoiceField(
        choices=["BORDEREAU", "LIVRAISON", "ETAT_PLV", "ANOMALIE"]
    )
    date_heure = serializers.DateTimeField()
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    taille_octets = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        op = attrs.get("operation_uuid")
        an = attrs.get("anomalie_uuid")
        if bool(op) == bool(an):
            raise serializers.ValidationError(
                "Une photo doit etre rattachee soit a une operation, soit "
                "a une anomalie, mais pas aux deux."
            )
        return attrs
