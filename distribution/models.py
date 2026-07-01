"""
Modèles métier du POC SODIGAZ.

Ce module définit l'ensemble du schéma de données de l'application.
Les tables sont regroupées en trois blocs correspondant à leur sens de
synchronisation avec le mobile :

       1. Référentiels (pull only) : données maîtres créées côté serveur/X3 :
          Vehicule, Client, Plv, Article.

       2. Semi-synchronisées (créées serveur, pull mobile) : données de
          planification générées par le mock X3 :
          Programme, Etape, LigneProgramme.

       3. Synchronisées en écriture (créées mobile, push serveur) : données
          terrain saisies hors-ligne par le livreur :
          Operation, LigneOperation, Anomalie, Photo.

Cette séparation traduit le flux de données offline-first.
Les référentiels et la planification descendent du serveur vers le mobile
(pull). Les données terrain remontent du mobile vers le serveur (push).
Aucun objet des blocs 1 et 2 n'est jamais créé par le mobile.

Champs de synchronisation (présents sur SyncableModel) :
  - uuid          : identifiant métier qui voyage entre client et serveur.
  - last_modified : BIGINT epoch ms, mis à jour par un trigger PostgreSQL.
                    Ne jamais écrire ce champ à la main (editable=False).
  - is_deleted    : suppression logique (soft delete) indispensable pour que
                    le mobile sache qu'un enregistrement doit être supprimé.
"""
import uuid as uuid_lib

from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.core.exceptions import ValidationError
from django.db import models


# =============================================================================
# Énumérations (TextChoices)
# WHAT : Valeurs métier autorisées pour chaque champ à choix limités.
# WHY  : TextChoices génère des constantes Python utilisables partout dans le
#        code (ex. StatutVisite.VISITEE) tout en stockant une chaîne lisible
#        en base, sans entier opaque ni migration si le libellé change.
# =============================================================================

class TypeProgramme(models.TextChoices):
    """COLLECTE = livreur ramasse des bouteilles vides / RESTITUTION = il livre du gaz plein."""
    COLLECTE    = "COLLECTE",    "Collecte"
    RESTITUTION = "RESTITUTION", "Restitution"


class StatutProgramme(models.TextChoices):
    """Cycle de vie d'un programme : PLANIFIE -> EN_COURS -> CLOTURE."""
    PLANIFIE = "PLANIFIE", "Planifie"
    EN_COURS = "EN_COURS", "En cours"
    CLOTURE  = "CLOTURE",  "Cloture"


class StatutVisite(models.TextChoices):
    """Résultat de la visite d'une étape par le livreur."""
    A_VISITER = "A_VISITER", "A visiter"
    VISITEE   = "VISITEE",   "Visitee"
    ECHEC     = "ECHEC",     "Echec"   # PLV inaccessible, client absent, etc.


class TypeOperation(models.TextChoices):
    COLLECTE          = "COLLECTE",          "Collecte"
    RESTITUTION       = "RESTITUTION",       "Restitution"
    LIVRAISON_DIRECTE = "LIVRAISON_DIRECTE", "Livraison directe"
    CONSIGNE          = "CONSIGNE",          "Consigne"


class SousTypeCollecte(models.TextChoices):
    """
    Distingue deux types de bons de collecte Sage X3.
    BCR (recharge) et BCT (transport) ont des traitements comptables
    différents dans X3. Le sous-type est obligatoire pour les COLLECTE.
    """
    BCR = "BCR", "Bon de Commande Recharge"
    BCT = "BCT", "Bon de Commande Transport"


class ModePaiement(models.TextChoices):
    ESPECES      = "ESPECES",      "Especes"
    MOBILE_MONEY = "MOBILE_MONEY", "Mobile Money"
    CHEQUE       = "CHEQUE",       "Cheque"
    VIREMENT     = "VIREMENT",     "Virement"
    CREDIT       = "CREDIT",       "Credit"


class TypeEmballage(models.TextChoices):
    """Types de bouteilles gaz commercialisés par SODIGAZ APC."""
    B6    = "B6",    "Bouteille 6 kg"
    B12_5 = "B12_5", "Bouteille 12,5 kg"
    B38   = "B38",   "Bouteille 38 kg"
    VRAC  = "VRAC",  "Vrac"


class TypeClient(models.TextChoices):
    DEPOT       = "DEPOT",       "Depot"
    REVENDEUR   = "REVENDEUR",   "Revendeur"
    GROS_CLIENT = "GROS_CLIENT", "Gros client"
    PARTICULIER = "PARTICULIER", "Particulier"


class StatutPlv(models.TextChoices):
    ACTIF    = "ACTIF",    "Actif"
    INACTIF  = "INACTIF",  "Inactif"
    SUSPENDU = "SUSPENDU", "Suspendu"


class GraviteAnomalie(models.TextChoices):
    FAIBLE  = "FAIBLE",  "Faible"
    MOYENNE = "MOYENNE", "Moyenne"
    ELEVEE  = "ELEVEE",  "Elevee"


class StatutAnomalie(models.TextChoices):
    OUVERTE        = "OUVERTE",        "Ouverte"
    EN_TRAITEMENT  = "EN_TRAITEMENT",  "En traitement"
    RESOLUE        = "RESOLUE",        "Resolue"


class TypePhoto(models.TextChoices):
    BORDEREAU = "BORDEREAU", "Bordereau signe"
    LIVRAISON = "LIVRAISON", "Preuve de livraison"
    ETAT_PLV  = "ETAT_PLV",  "Etat du PLV"
    ANOMALIE  = "ANOMALIE",  "Anomalie"


# Valeur sentinelle : fichier photo non encore uploadé (push métadonnées
# avant upload binaire). Partagée entre engine.py et nettoyer_photos_orphelines.
PHOTO_PLACEHOLDER = "placeholder.bin"


# =============================================================================
# Mixins
# =============================================================================

class TimestampedModel(models.Model):
    """
    Ajoute created_at et updated_at automatiques à chaque table.
    Traçabilité minimale sur toutes les tables, y compris les référentiels
    qui ne participent pas à la synchronisation mobile.
    """
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class SyncableModel(TimestampedModel):
    """
    Mixin pour les tables qui participent au protocole de synchronisation
    mobile. Ajoute les champs techniques nécessaires au delta pull/push.

    WatermelonDB et notre protocole utilisent
    des timestamps en millisecondes (BigInt SQLite). Le trigger PostgreSQL
    défini dans la migration 0002 met ce champ à jour automatiquement à
    chaque INSERT ou UPDATE. Ne jamais l'écrire manuellement : cela
    casserait le delta incrémental du pull.

    Supprimer physiquement un enregistrement
    le ferait disparaître du delta : le mobile ne saurait pas qu'il doit
    le supprimer localement. Le soft delete permet de transmettre l'UUID
    dans la liste `deleted` du pull.
    """
    last_modified = models.BigIntegerField(
        default=0,
        editable=False,
        help_text="Timestamp epoch ms, mis à jour par trigger PostgreSQL",
    )
    is_deleted = models.BooleanField(default=False)

    class Meta:
        abstract = True


# =============================================================================
# 1. TABLES DE RÉFÉRENCE (pull only, lecture seule côté mobile)
# =============================================================================

class Vehicule(TimestampedModel):
    """
    Véhicule de livraison affecté à un programme.
    Séparé de Programme pour permettre la réutilisation et l'historique
    d'affectation véhicule/livreur.
    """
    immatriculation = models.CharField(max_length=20, unique=True)
    type            = models.CharField(max_length=50, blank=True)
    capacite        = models.PositiveIntegerField(null=True, blank=True)
    actif           = models.BooleanField(default=True)

    class Meta:
        db_table = "vehicule"

    def __str__(self) -> str:
        return self.immatriculation


class Client(TimestampedModel):
    """
    Client final (dépôt, revendeur, particulier) desservi par SODIGAZ.
    Clé de correspondance avec le module BPCUSTOMER de Sage X3.
    Toute donnée client créée dans X3 est identifiable par ce code.
    """
    code_x3        = models.CharField(
        max_length=30, unique=True,
        help_text="Code de correspondance Sage X3 (BPCUSTOMER)",
    )
    raison_sociale = models.CharField(max_length=255)
    type_client    = models.CharField(max_length=20, choices=TypeClient.choices)
    contact        = models.CharField(max_length=100, blank=True)
    telephone      = models.CharField(max_length=20, blank=True)
    actif          = models.BooleanField(default=True)

    class Meta:
        db_table = "client"
        indexes  = [
            models.Index(fields=["code_x3"]),
            models.Index(fields=["raison_sociale"]),
        ]

    def __str__(self) -> str:
        return self.raison_sociale


class Plv(gis_models.Model):
    """
    Point de Livraison : adresse physique chez le client où le livreur
    se rend pour effectuer une opération.

    geography stocke les coordonnées
    en WGS84 et permet des calculs de distance en mètres natifs via PostGIS.
    C'est ce qu'utilise l'heuristique du plus proche voisin (circuit.py).
    SRID 4326 = standard GPS mondial.
    """
    client    = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="plvs")
    code_plv  = models.CharField(
        max_length=20, unique=True, null=True, blank=True,
        help_text="Identifiant unique du PLV. Ex : PLVO101 (O=Ouaga), PLVB063 (B=Bobo)",
    )
    libelle      = models.CharField(max_length=255)
    adresse      = models.TextField(blank=True)
    localisation = gis_models.PointField(geography=True, srid=4326)
    statut       = models.CharField(
        max_length=20, choices=StatutPlv.choices, default=StatutPlv.ACTIF
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "plv"
        indexes  = [
            models.Index(fields=["client"]),
            models.Index(fields=["statut"]),
        ]

    def __str__(self) -> str:
        if self.code_plv:
            return f"{self.code_plv} : {self.libelle}"
        return self.libelle


class Article(TimestampedModel):
    """
    Article de gaz commercialisé (bouteille 6 kg, 12,5 kg, 38 kg, vrac...).
    Clé de correspondance avec ITMMASTER dans Sage X3.
    Renommage du modèle de Produit -> Article pour
    aligner la terminologie métier. La table SQL reste "produit" pour
    éviter une migration ALTER TABLE sur les données existantes.
    Les FK `produit_id` dans LigneProgramme et LigneOperation conservent
    aussi leurs noms SQL : ce sont des détails ORM internes.
    """
    code_x3              = models.CharField(max_length=30, unique=True)
    libelle              = models.CharField(max_length=255)
    type_emballage       = models.CharField(max_length=10, choices=TypeEmballage.choices)
    prix_unitaire        = models.DecimalField(max_digits=12, decimal_places=2)
    montant_consignation = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Montant de la consigne facturé à la première livraison de l'emballage",
    )
    actif = models.BooleanField(default=True)

    class Meta:
        db_table    = "produit"  # conservé pour ne pas altérer la base de données
        indexes     = [models.Index(fields=["code_x3"])]
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
# 2. TABLES SEMI-SYNCHRONISÉES (créées serveur par le mock X3, pull mobile)
# =============================================================================

class Programme(SyncableModel):
    """
    Plan de tournée d'un livreur pour une journée donnée.
    Créé automatiquement par le mock X3 (generer_programmes_du_jour).

    Les enregistrements des blocs 1 et 2 ont leur
    UUID généré côté serveur. Ceux du bloc 3 (terrain) n'ont PAS de
    default : leur UUID est fourni par le mobile au push.

    Un numéro X3 doit être
    unique parmi les programmes actifs (non supprimés). La contrainte
    partielle (WHERE is_deleted=False) permet de recréer un programme
    avec le même numéro après un soft-delete.
    """
    uuid           = models.UUIDField(unique=True, default=uuid_lib.uuid4, editable=False)
    numero_x3      = models.CharField(max_length=50, help_text="Numéro de programme côté Sage X3")
    utilisateur    = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="programmes",
    )
    vehicule       = models.ForeignKey(
        Vehicule, on_delete=models.SET_NULL, null=True, blank=True, related_name="programmes"
    )
    date_programme = models.DateField()
    type_programme = models.CharField(max_length=20, choices=TypeProgramme.choices)
    statut         = models.CharField(
        max_length=20, choices=StatutProgramme.choices, default=StatutProgramme.PLANIFIE
    )
    heure_debut    = models.DateTimeField(null=True, blank=True)
    heure_fin      = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table    = "programme"
        constraints = [
            # Unicité partielle : autorise soft-delete + recréation avec même numéro X3.
            models.UniqueConstraint(
                fields=["numero_x3"],
                name="uq_programme_numero_x3",
                condition=models.Q(is_deleted=False),
            ),
        ]
        indexes = [
            models.Index(fields=["utilisateur", "date_programme"]),
            models.Index(fields=["last_modified"]),
        ]

    def __str__(self) -> str:
        return f"{self.numero_x3} ({self.date_programme})"


class Etape(SyncableModel):
    """
    Une visite planifiée chez un PLV dans le cadre d'un programme.
    Chaque étape représente un arrêt sur la tournée du livreur.

    ordre_prevu est l'ordre original
    saisi dans X3. ordre_optimise est calculé par l'heuristique du
    plus proche voisin (circuit.py) et stocké ici. Le livreur voit
    l'ordre optimisé comme recommandation, mais reste libre de son
    itinéraire réel.
    """
    uuid           = models.UUIDField(unique=True, default=uuid_lib.uuid4, editable=False)
    programme      = models.ForeignKey(Programme, on_delete=models.CASCADE, related_name="etapes")
    plv            = models.ForeignKey(Plv, on_delete=models.PROTECT, related_name="etapes")
    ordre_prevu    = models.PositiveIntegerField()
    ordre_optimise = models.PositiveIntegerField(null=True, blank=True)
    statut_visite  = models.CharField(
        max_length=20, choices=StatutVisite.choices, default=StatutVisite.A_VISITER
    )

    class Meta:
        db_table    = "etape"
        constraints = [
            models.UniqueConstraint(
                fields=["programme", "ordre_prevu"], name="uq_etape_programme_ordre"
            ),
        ]
        indexes = [models.Index(fields=["last_modified"])]

    def __str__(self) -> str:
        return f"Etape {self.ordre_prevu} - {self.plv}"


class LigneProgramme(SyncableModel):
    """
    Quantité prévue d'un article pour une étape (le PRÉVU côté planification).
    Contrepartie de LigneOperation qui représente le RÉALISÉ terrain.

    La FK garde son nom SQL
    `produit_id` pour éviter une migration de colonne. Le nom Python
    est `produit` mais pointe sur le modèle Article.
    """
    uuid            = models.UUIDField(unique=True, default=uuid_lib.uuid4, editable=False)
    etape           = models.ForeignKey(Etape, on_delete=models.CASCADE, related_name="lignes_prevues")
    produit         = models.ForeignKey(Article, on_delete=models.PROTECT)
    quantite_prevue = models.PositiveIntegerField()

    class Meta:
        db_table    = "ligne_programme"
        constraints = [
            models.UniqueConstraint(
                fields=["etape", "produit"], name="uq_ligne_programme_etape_produit"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.produit} x{self.quantite_prevue} (prévu)"


# =============================================================================
# 3. TABLES SYNCHRONISÉES EN ÉCRITURE (créées mobile, push serveur)
# =============================================================================
# NOTE : pour ces tables, uuid n'a PAS de default. Il est généré côté mobile
# (Crypto.randomUUID()) et transmis au push. Le serveur le reçoit et l'accepte
# via update_or_create : c'est la base de l'idempotence du push.

class Operation(SyncableModel):
    """
    Enregistrement d'une visite terrain réalisée par le livreur chez un
    PLV. Contient les données de règlement, signatures et géolocalisation.

    Même choix que pour Plv : calculs
    métriques natifs. Le point est capturé au moment de la saisie sur le
    mobile (pas en temps réel). La précision GPS est stockée séparément.

    Deux champs distincts permettent de
    qualifier la fiabilité du point GPS. Un fix satellite (5-15 m) n'a
    pas la même valeur probante qu'un fix réseau (70-100 m). Le seuil
    SEUIL_FIABLE_METRES = 100 m est défini dans locationService.ts.

    sous_type (BCR/BCT) n'a de sens que
    pour les COLLECTE. La contrainte SQL garantit cette règle même si
    le mobile envoie une valeur incohérente.
    """
    uuid                  = models.UUIDField(unique=True, editable=False, help_text="Généré côté mobile")
    etape                 = models.ForeignKey(Etape, on_delete=models.PROTECT, related_name="operations")
    type_operation        = models.CharField(max_length=30, choices=TypeOperation.choices)
    sous_type             = models.CharField(
        max_length=10, choices=SousTypeCollecte.choices, null=True, blank=True,
        help_text="BCR ou BCT : obligatoire pour les COLLECTE uniquement",
    )
    date_heure            = models.DateTimeField()
    localisation_saisie   = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    gps_precision         = models.FloatField(
        null=True, blank=True,
        help_text="Rayon d'incertitude GPS en mètres au moment de la saisie.",
    )
    gps_horodatage        = models.DateTimeField(
        null=True, blank=True,
        help_text="Horodatage de l'acquisition GPS (peut différer de date_heure).",
    )
    mode_paiement         = models.CharField(
        max_length=20, choices=ModePaiement.choices, null=True, blank=True
    )
    montant_total         = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    montant_encaisse      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    est_encaissee         = models.BooleanField(default=False)
    # Signatures sous forme d'image base64 : valeur probante limitée au POC.
    signature_livreur     = models.TextField(blank=True)
    signature_client      = models.TextField(blank=True)
    nom_signataire_client = models.CharField(max_length=255, blank=True)
    commentaire           = models.TextField(blank=True)

    class Meta:
        db_table    = "operation"
        constraints = [
            # sous_type renseigné SI ET SEULEMENT SI type_operation == COLLECTE.
            models.CheckConstraint(
                check=(
                    models.Q(type_operation="COLLECTE", sous_type__isnull=False)
                    | (~models.Q(type_operation="COLLECTE") & models.Q(sous_type__isnull=True))
                ),
                name="chk_operation_sous_type",
            ),
            models.CheckConstraint(
                check=models.Q(montant_total__gte=0), name="op_montant_total_positif"
            ),
            models.CheckConstraint(
                check=models.Q(montant_encaisse__gte=0), name="op_montant_encaisse_positif"
            ),
        ]
        indexes = [
            models.Index(fields=["etape"]),
            models.Index(fields=["date_heure"]),
            models.Index(fields=["last_modified"]),
        ]

    def __str__(self) -> str:
        return f"{self.type_operation} - étape {self.etape_id}"


class LigneOperation(SyncableModel):
    """
    Ligne de détail d'une opération : quantité réalisée par article
    (le RÉALISÉ terrain, à comparer au PRÉVU dans LigneProgramme).

    Les types d'emballage (pleins/vides) et les
    consignes/déconsignes nécessitent un suivi distinct pour le
    rapprochement comptable avec X3.
    """
    uuid                      = models.UUIDField(unique=True, editable=False, help_text="Généré côté mobile")
    operation                 = models.ForeignKey(Operation, on_delete=models.CASCADE, related_name="lignes")
    produit                   = models.ForeignKey(Article, on_delete=models.PROTECT)
    quantite_realisee         = models.PositiveIntegerField(default=0)
    quantite_collectee_vide   = models.PositiveIntegerField(default=0)
    quantite_consignee        = models.PositiveIntegerField(default=0)
    quantite_deconsignee      = models.PositiveIntegerField(default=0)
    montant_ligne             = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table    = "ligne_operation"
        constraints = [
            models.UniqueConstraint(
                fields=["operation", "produit"], name="uq_ligne_op_op_produit"
            ),
        ]
        indexes = [models.Index(fields=["last_modified"])]

    def __str__(self) -> str:
        return f"{self.produit} x{self.quantite_realisee} (réalisé)"


class Anomalie(SyncableModel):
    """
    Incident constaté par le livreur pendant sa tournée (PLV inaccessible,
    matériel défectueux, problème client...). Rattachée au programme
    (pas à une étape spécifique, car elle peut concerner la tournée entière).
    """
    uuid          = models.UUIDField(unique=True, editable=False, help_text="Généré côté mobile")
    programme     = models.ForeignKey(Programme, on_delete=models.CASCADE, related_name="anomalies")
    plv           = models.ForeignKey(
        Plv, on_delete=models.SET_NULL, null=True, blank=True, related_name="anomalies"
    )
    type_anomalie = models.CharField(max_length=100)
    gravite       = models.CharField(
        max_length=20, choices=GraviteAnomalie.choices, default=GraviteAnomalie.MOYENNE
    )
    description   = models.TextField()
    statut        = models.CharField(
        max_length=20, choices=StatutAnomalie.choices, default=StatutAnomalie.OUVERTE
    )
    date_heure    = models.DateTimeField()
    localisation  = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)

    class Meta:
        db_table = "anomalie"
        indexes  = [
            models.Index(fields=["programme"]),
            models.Index(fields=["statut"]),
            models.Index(fields=["last_modified"]),
        ]

    def __str__(self) -> str:
        return f"{self.type_anomalie} ({self.gravite}) - {self.programme}"


class Photo(SyncableModel):
    """
    Pièce jointe photographique rattachée soit à une opération, soit à
    une anomalie. Un seul des deux liens (operation / anomalie) est
    renseigné : jamais les deux, jamais aucun (contrainte XOR).

    Une photo de bordereau signé appartient à
    une opération ; une photo d'un PLV endommagé appartient à une anomalie.
    Fusionner les deux cas dans une table unique évite deux tables séparées
    photo_operation et photo_anomalie avec du code dupliqué.

    WHY (CheckConstraint + clean()) : La contrainte SQL garantit l'intégrité
    même en cas de bypass de l'API. La méthode clean() fournit un message
    d'erreur lisible côté admin Django.
    """
    uuid          = models.UUIDField(unique=True, editable=False, help_text="Généré côté mobile")
    operation     = models.ForeignKey(
        Operation, on_delete=models.CASCADE, null=True, blank=True, related_name="photos"
    )
    anomalie      = models.ForeignKey(
        Anomalie, on_delete=models.CASCADE, null=True, blank=True, related_name="photos"
    )
    fichier       = models.ImageField(upload_to="photos/%Y/%m/%d/")
    type_photo    = models.CharField(max_length=20, choices=TypePhoto.choices)
    localisation  = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    date_heure    = models.DateTimeField()
    taille_octets = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table    = "photo"
        constraints = [
            # XOR : exactement l'un des deux liens (operation, anomalie) est renseigné.
            models.CheckConstraint(
                check=(
                    (models.Q(operation__isnull=False) & models.Q(anomalie__isnull=True))
                    | (models.Q(operation__isnull=True) & models.Q(anomalie__isnull=False))
                ),
                name="chk_photo_exclusivite",
            ),
        ]
        indexes = [models.Index(fields=["last_modified"])]

    def __str__(self) -> str:
        return f"Photo {self.type_photo} - {self.uuid}"

    def clean(self) -> None:
        """
        Validation Python de la contrainte XOR, en plus de la contrainte SQL.
        La CheckConstraint SQL n'est vérifiée qu'à la persistance en base.
        clean() est appelée par le formulaire admin et les forms Django,
        offrant un message d'erreur lisible avant d'atteindre la base.
        """
        super().clean()
        if bool(self.operation_id) == bool(self.anomalie_id):
            raise ValidationError(
                "Une photo doit être rattachée soit à une opération, "
                "soit à une anomalie, mais pas aux deux."
            )
