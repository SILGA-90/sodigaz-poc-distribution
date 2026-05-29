"""Serializers de l'API simulant Sage X3."""
from rest_framework import serializers


class LignePrevueSerializer(serializers.Serializer):
    code_produit_x3 = serializers.CharField()
    libelle_produit = serializers.CharField()
    quantite_prevue = serializers.IntegerField(min_value=0)


class EtapeProgrammeSerializer(serializers.Serializer):
    ordre = serializers.IntegerField()
    code_client_x3 = serializers.CharField()
    raison_sociale_client = serializers.CharField()
    libelle_plv = serializers.CharField()
    adresse_plv = serializers.CharField(allow_blank=True)
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()
    lignes_prevues = LignePrevueSerializer(many=True)


class ProgrammeJourSerializer(serializers.Serializer):
    numero_x3 = serializers.CharField()
    code_livreur = serializers.CharField()
    date_programme = serializers.DateField()
    type_programme = serializers.ChoiceField(choices=["COLLECTE", "RESTITUTION"])
    immatriculation_vehicule = serializers.CharField(allow_null=True, required=False)
    etapes = EtapeProgrammeSerializer(many=True)


class LigneOperationRemonteeSerializer(serializers.Serializer):
    code_produit_x3 = serializers.CharField()
    quantite_realisee = serializers.IntegerField(min_value=0)
    quantite_consignee = serializers.IntegerField(min_value=0, default=0)
    quantite_deconsignee = serializers.IntegerField(min_value=0, default=0)
    montant_ligne = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)


class OperationRemonteeSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    numero_programme_x3 = serializers.CharField()
    code_client_x3 = serializers.CharField()
    type_operation = serializers.ChoiceField(
        choices=["COLLECTE", "RESTITUTION", "LIVRAISON_DIRECTE", "CONSIGNE"]
    )
    date_heure = serializers.DateTimeField()
    montant_total = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    montant_encaisse = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    mode_paiement = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    nom_signataire_client = serializers.CharField(required=False, allow_blank=True)
    commentaire = serializers.CharField(required=False, allow_blank=True)
    lignes = LigneOperationRemonteeSerializer(many=True)
