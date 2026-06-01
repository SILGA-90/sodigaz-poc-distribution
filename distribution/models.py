"""
Modeles metier du POC SODIGAZ.

Organisation en 3 blocs miroir du SQL :
  1. Tables de reference (pull only depuis le mobile)
  2. Tables semi-synchronisees (creees cote serveur par le mock X3, pull mobile)
  3. Tables synchronisees en ecriture (creees cote mobile, push serveur)

Champs de synchronisation :
  - uuid : identifiant metier qui voyage entre client et serveur
  - last_modified (BIGINT, ms) : timestamp pour le pull incremental de WatermelonDB
  - is_deleted : suppression logique, indispensable pour la synchro
"""
import uuid as uuid_lib

from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.core.exceptions import ValidationError
from django.db import models


# =============================================================================
# Enumerations (TextChoices)
# =============================================================================

class TypeProgramme(models.TextChoices):
    COLLECTE = "COLLECTE", "Collecte"
    RESTITUTION = "RESTITUTION", "Restitution"


class StatutProgramme(models.TextChoices):
    PLANIFIE = "PLANIFIE", "Planifie"
    EN_COURS = "EN_COURS", "En cours"
    CLOTURE = "CLOTURE", "Cloture"


class StatutVisite(models.TextChoices):
    A_VISITER = "A_VISITER", "A visiter"
    VISITEE = "VISITEE", "Visitee"
    ECHEC = "ECHEC", "Echec"


class TypeOperation(models.TextChoices):
    COLLECTE = "COLLECTE", "Collecte"
    RESTITUTION = "RESTITUTION", "Restitution"
    LIVRAISON_DIRECTE = "LIVRAISON_DIRECTE", "Livraison directe"
    CONSIGNE = "CONSIGNE", "Consigne"


class SousTypeCollecte(models.TextChoices):
    BCR = "BCR", "Bon de Collecte Recharge"
    BCT = "BCT", "Bon de Collecte Transport"


class ModePaiement(models.TextChoices):
    ESPECES = "ESPECES", "Especes"
    MOBILE_MONEY = "MOBILE_MONEY", "Mobile Money"
    CHEQUE = "CHEQUE", "Cheque"
    VIREMENT = "VIREMENT", "Virement"
    CREDIT = "CREDIT", "Credit"


class TypeEmballage(models.TextChoices):
    B6 = "B6", "Bouteille 6 kg"
    B12_5 = "B12_5", "Bouteille 12,5 kg"
    B38 = "B38", "Bouteille 38 kg"
    VRAC = "VRAC", "Vrac"


class TypeClient(models.TextChoices):
    DEPOT = "DEPOT", "Depot"
    REVENDEUR = "REVENDEUR", "Revendeur"
    GROS_CLIENT = "GROS_CLIENT", "Gros client"
    PARTICULIER = "PARTICULIER", "Particulier"


class StatutPlv(models.TextChoices):
    ACTIF = "ACTIF", "Actif"
    INACTIF = "INACTIF", "Inactif"
    SUSPENDU = "SUSPENDU", "Suspendu"


class GraviteAnomalie(models.TextChoices):
    FAIBLE = "FAIBLE", "Faible"
    MOYENNE = "MOYENNE", "Moyenne"
    ELEVEE = "ELEVEE", "Elevee"


class StatutAnomalie(models.TextChoices):
    OUVERTE = "OUVERTE", "Ouverte"
    EN_TRAITEMENT = "EN_TRAITEMENT", "En traitement"
    RESOLUE = "RESOLUE", "Resolue"


class TypePhoto(models.TextChoices):
    BORDEREAU = "BORDEREAU", "Bordereau signe"
    LIVRAISON = "LIVRAISON", "Preuve de livraison"
    ETAT_PLV = "ETAT_PLV", "Etat du PLV"
    ANOMALIE = "ANOMALIE", "Anomalie"


# =============================================================================
# Mixins
# =============================================================================

class TimestampedModel(models.Model):
    """Traceabilite de base sur toutes les tables."""
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class SyncableModel(TimestampedModel):
    """
    Tables qui transitent dans la synchronisation mobile.
    - last_modified : mis a jour par trigger PostgreSQL
    - is_deleted : suppression logique
    """
    last_modified = models.BigIntegerField(
        default=0,
        editable=False,
        help_text="Timestamp epoch ms, mis a jour par trigger",
    )
    is_deleted = models.BooleanField(default=False)

    class Meta:
        abstract = True


# =============================================================================
# 1. TABLES DE REFERENCE
# =============================================================================

class Vehicule(TimestampedModel):
    immatriculation = models.CharField(max_length=20, unique=True)
    type = models.CharField(max_length=50, blank=True)
    capacite = models.PositiveIntegerField(null=True, blank=True)
    actif = models.BooleanField(default=True)

    class Meta:
        db_table = "vehicule"

    def __str__(self) -> str:
        return self.immatriculation


class Client(TimestampedModel):
    code_x3 = models.CharField(
        max_length=30, unique=True,
        help_text="Code de correspondance Sage X3 (BPCUSTOMER)",
    )
    raison_sociale = models.CharField(max_length=255)
    type_client = models.CharField(max_length=20, choices=TypeClient.choices)
    contact = models.CharField(max_length=100, blank=True)
    telephone = models.CharField(max_length=20, blank=True)
    actif = models.BooleanField(default=True)

    class Meta:
        db_table = "client"
        indexes = [
            models.Index(fields=["code_x3"]),
            models.Index(fields=["raison_sociale"]),
        ]

    def __str__(self) -> str:
        return self.raison_sociale


class Plv(gis_models.Model):
    """Point de Livraison."""
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="plvs")
    libelle = models.CharField(max_length=255)
    adresse = models.TextField(blank=True)
    # geography(POINT, 4326) : calculs en metres natifs
    localisation = gis_models.PointField(geography=True, srid=4326)
    statut = models.CharField(max_length=20, choices=StatutPlv.choices, default=StatutPlv.ACTIF)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "plv"
        indexes = [
            models.Index(fields=["client"]),
            models.Index(fields=["statut"]),
        ]

    def __str__(self) -> str:
        return self.libelle


class Produit(TimestampedModel):
    code_x3 = models.CharField(max_length=30, unique=True)
    libelle = models.CharField(max_length=255)
    type_emballage = models.CharField(max_length=10, choices=TypeEmballage.choices)
    prix_unitaire = models.DecimalField(max_digits=12, decimal_places=2)
    montant_consignation = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    actif = models.BooleanField(default=True)

    class Meta:
        db_table = "produit"
        indexes = [models.Index(fields=["code_x3"])]
        constraints = [
            models.CheckConstraint(
                check=models.Q(prix_unitaire__gte=0), name="produit_prix_positif"
            ),
            models.CheckConstraint(
                check=models.Q(montant_consignation__gte=0), name="produit_consignation_positive"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.code_x3} - {self.libelle}"


# =============================================================================
# 2. TABLES SEMI-SYNCHRONISEES (creees serveur, pull mobile)
# =============================================================================

class Programme(SyncableModel):
    uuid = models.UUIDField(unique=True, default=uuid_lib.uuid4, editable=False)
    numero_x3 = models.CharField(max_length=30, unique=True, help_text="N de programme cote Sage X3")
    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="programmes",
    )
    vehicule = models.ForeignKey(
        Vehicule, on_delete=models.SET_NULL, null=True, blank=True, related_name="programmes"
    )
    date_programme = models.DateField()
    type_programme = models.CharField(max_length=20, choices=TypeProgramme.choices)
    statut = models.CharField(max_length=20, choices=StatutProgramme.choices, default=StatutProgramme.PLANIFIE)
    heure_debut = models.DateTimeField(null=True, blank=True)
    heure_fin = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "programme"
        constraints = [
            models.UniqueConstraint(
                fields=["utilisateur", "date_programme", "type_programme"],
                name="uq_programme_livreur_jour",
            ),
        ]
        indexes = [
            models.Index(fields=["utilisateur", "date_programme"]),
            models.Index(fields=["last_modified"]),
        ]

    def __str__(self) -> str:
        return f"{self.numero_x3} ({self.date_programme})"


class Etape(SyncableModel):
    uuid = models.UUIDField(unique=True, default=uuid_lib.uuid4, editable=False)
    programme = models.ForeignKey(Programme, on_delete=models.CASCADE, related_name="etapes")
    plv = models.ForeignKey(Plv, on_delete=models.PROTECT, related_name="etapes")
    ordre_prevu = models.PositiveIntegerField()
    ordre_optimise = models.PositiveIntegerField(null=True, blank=True)
    statut_visite = models.CharField(
        max_length=20, choices=StatutVisite.choices, default=StatutVisite.A_VISITER
    )

    class Meta:
        db_table = "etape"
        constraints = [
            models.UniqueConstraint(fields=["programme", "ordre_prevu"], name="uq_etape_programme_ordre"),
        ]
        indexes = [models.Index(fields=["last_modified"])]


class LigneProgramme(SyncableModel):
    uuid = models.UUIDField(unique=True, default=uuid_lib.uuid4, editable=False)
    etape = models.ForeignKey(Etape, on_delete=models.CASCADE, related_name="lignes_prevues")
    produit = models.ForeignKey(Produit, on_delete=models.PROTECT)
    quantite_prevue = models.PositiveIntegerField()

    class Meta:
        db_table = "ligne_programme"
        constraints = [
            models.UniqueConstraint(fields=["etape", "produit"], name="uq_ligne_programme_etape_produit"),
        ]


# =============================================================================
# 3. TABLES SYNCHRONISEES EN ECRITURE (creees mobile, push serveur)
# =============================================================================
# NOTE : pour ces tables, uuid n'a PAS de default : il est genere cote mobile
# et fourni au push. On le rend unique mais on impose qu'il soit toujours
# transmis par le client.

class Operation(SyncableModel):
    uuid = models.UUIDField(unique=True, editable=False, help_text="Genere cote mobile")
    etape = models.ForeignKey(Etape, on_delete=models.PROTECT, related_name="operations")
    type_operation = models.CharField(max_length=30, choices=TypeOperation.choices)
    sous_type = models.CharField(
        max_length=10, choices=SousTypeCollecte.choices, null=True, blank=True
    )
    date_heure = models.DateTimeField()
    localisation_saisie = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    gps_precision = models.FloatField(
        null=True, blank=True,
        help_text="Rayon d'incertitude de la position GPS en metres (valeur probante).",
    )
    gps_horodatage = models.DateTimeField(
        null=True, blank=True,
        help_text="Horodatage de l'acquisition GPS au moment de l'enregistrement.",
    )
    # Reglement
    mode_paiement = models.CharField(
        max_length=20, choices=ModePaiement.choices, null=True, blank=True
    )
    montant_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    montant_encaisse = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    est_encaissee = models.BooleanField(default=False)
    # Signatures (capture image, valeur probante limitee)
    signature_livreur = models.TextField(blank=True)
    signature_client = models.TextField(blank=True)
    nom_signataire_client = models.CharField(max_length=255, blank=True)
    commentaire = models.TextField(blank=True)

    class Meta:
        db_table = "operation"
        constraints = [
            # Coherence : sous_type renseigne SI ET SEULEMENT SI c'est une collecte
            models.CheckConstraint(
                check=(
                    models.Q(type_operation="COLLECTE", sous_type__isnull=False)
                    | (~models.Q(type_operation="COLLECTE") & models.Q(sous_type__isnull=True))
                ),
                name="chk_operation_sous_type",
            ),
            models.CheckConstraint(check=models.Q(montant_total__gte=0), name="op_montant_total_positif"),
            models.CheckConstraint(check=models.Q(montant_encaisse__gte=0), name="op_montant_encaisse_positif"),
        ]
        indexes = [
            models.Index(fields=["etape"]),
            models.Index(fields=["date_heure"]),
            models.Index(fields=["last_modified"]),
        ]


class LigneOperation(SyncableModel):
    uuid = models.UUIDField(unique=True, editable=False, help_text="Genere cote mobile")
    operation = models.ForeignKey(Operation, on_delete=models.CASCADE, related_name="lignes")
    produit = models.ForeignKey(Produit, on_delete=models.PROTECT)
    quantite_realisee = models.PositiveIntegerField(default=0)
    quantite_collectee_vide = models.PositiveIntegerField(default=0)
    quantite_consignee = models.PositiveIntegerField(default=0)
    quantite_deconsignee = models.PositiveIntegerField(default=0)
    montant_ligne = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = "ligne_operation"
        constraints = [
            models.UniqueConstraint(fields=["operation", "produit"], name="uq_ligne_op_op_produit"),
        ]
        indexes = [models.Index(fields=["last_modified"])]


class Anomalie(SyncableModel):
    uuid = models.UUIDField(unique=True, editable=False, help_text="Genere cote mobile")
    programme = models.ForeignKey(Programme, on_delete=models.CASCADE, related_name="anomalies")
    plv = models.ForeignKey(Plv, on_delete=models.SET_NULL, null=True, blank=True, related_name="anomalies")
    type_anomalie = models.CharField(max_length=100)
    gravite = models.CharField(max_length=20, choices=GraviteAnomalie.choices, default=GraviteAnomalie.MOYENNE)
    description = models.TextField()
    statut = models.CharField(max_length=20, choices=StatutAnomalie.choices, default=StatutAnomalie.OUVERTE)
    date_heure = models.DateTimeField()
    localisation = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)

    class Meta:
        db_table = "anomalie"
        indexes = [
            models.Index(fields=["programme"]),
            models.Index(fields=["statut"]),
            models.Index(fields=["last_modified"]),
        ]


class Photo(SyncableModel):
    """
    Entite unifiee : une photo est attachee SOIT a une operation, SOIT a une anomalie.
    L'exclusivite est verifiee par une CheckConstraint en base ET par clean() en Django.
    """
    uuid = models.UUIDField(unique=True, editable=False, help_text="Genere cote mobile")
    operation = models.ForeignKey(
        Operation, on_delete=models.CASCADE, null=True, blank=True, related_name="photos"
    )
    anomalie = models.ForeignKey(
        Anomalie, on_delete=models.CASCADE, null=True, blank=True, related_name="photos"
    )
    fichier = models.ImageField(upload_to="photos/%Y/%m/%d/")
    type_photo = models.CharField(max_length=20, choices=TypePhoto.choices)
    localisation = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    date_heure = models.DateTimeField()
    taille_octets = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "photo"
        constraints = [
            # Exactement l'un des deux liens est renseigne (XOR)
            models.CheckConstraint(
                check=(
                    (models.Q(operation__isnull=False) & models.Q(anomalie__isnull=True))
                    | (models.Q(operation__isnull=True) & models.Q(anomalie__isnull=False))
                ),
                name="chk_photo_exclusivite",
            ),
        ]
        indexes = [models.Index(fields=["last_modified"])]

    def clean(self) -> None:
        """Validation cote Python en plus de la contrainte SQL."""
        super().clean()
        if bool(self.operation_id) == bool(self.anomalie_id):
            raise ValidationError(
                "Une photo doit etre rattachee soit a une operation, soit a une anomalie, mais pas aux deux."
            )
