"""
Commande de peuplement initial de la base de démonstration.

Cette commande crée un jeu de données de démonstration complet :
livreurs, superviseurs, véhicules, articles (gaz + emballages),
clients et PLVs géolocalisés à Ouagadougou.

Les fixtures JSON ne gèrent
pas la création de mots de passe (set_password) ni les objets GeoDjango
(PointField). Une commande Python les gère proprement et est rejouable.

Contrairement au --reset de
generer_programmes_du_jour (soft-delete), ici on fait un DELETE physique
car on recrée tout de zéro. Les données de démo ne sont pas des données
de production : aucune mobile ne peut en avoir une copie locale.

La commande est idempotente sans --reset : si les données
existent déjà, on ne les recrée pas. Pratique pour rejouer partiellement.

- E* (emballages vides) : bouteilles vides collectées en COLLECTE.
         Prix unitaire = 0 (pas de facturation gaz), montant_consignation
         = montant de la caution sur l'emballage.
       - G* (gaz plein) : bouteilles rechargées livrées en RESTITUTION.
         Prix unitaire = prix de la recharge (hors consignation déjà payée).

Données de démo (voir CLAUDE.md §7) :
  - Mot de passe commun : demo1234
  - Livreurs : LIV001..LIV005
  - Superviseur : aminata.traore
  - 25 PLVs à Ouagadougou, 15 clients, 6 articles (3 E* + 3 G*)
  - Centre de carte : [12.3650, -1.5236]
"""
from decimal import Decimal

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Role, Utilisateur
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
    StatutPlv,
    TypeClient,
    TypeEmballage,
    Vehicule,
)

DEMO_PASSWORD = "demo1234"


class Command(BaseCommand):
    help = "Peuple la base avec un jeu de données de démonstration."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Supprime les données de démo existantes avant de créer.",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            self.stdout.write(self.style.WARNING("Reset des données de démo..."))
            # Suppression dans l'ordre imposé par les PROTECT (feuilles avant racines)
            Photo.objects.all().delete()
            LigneOperation.objects.all().delete()
            Anomalie.objects.all().delete()
            Operation.objects.all().delete()
            LigneProgramme.objects.all().delete()
            Etape.objects.all().delete()
            Programme.objects.all().delete()
            Plv.objects.all().delete()
            Client.objects.all().delete()
            Article.objects.all().delete()
            Vehicule.objects.all().delete()
            Utilisateur.objects.filter(code_livreur__startswith="LIV").delete()
            Utilisateur.objects.filter(username__in=["aminata.traore", "aminata.s"]).delete()

        with transaction.atomic():
            self._creer_utilisateurs()
            self._creer_vehicules()
            self._creer_articles()
            clients = self._creer_clients()
            self._creer_plvs(clients)

        self.stdout.write(self.style.SUCCESS("\nSeed terminé."))
        self.stdout.write(
            self.style.NOTICE(f"\nMots de passe des comptes démo : {DEMO_PASSWORD}\n")
        )

    def _creer_utilisateurs(self):
        """
        Crée les comptes livreurs (LIV001-LIV005) et le superviseur (aminata.traore).
        Idempotent : si le compte existe déjà, on ne le recrée pas.
        """
        comptes = [
            {"username": "adama.ouedraogo",  "code_livreur": "LIV001",
             "nom": "OUEDRAOGO", "prenom": "Adama",   "telephone": "+22670000001", "role": Role.LIVREUR},
            {"username": "salif.kabore",      "code_livreur": "LIV002",
             "nom": "KABORE",    "prenom": "Salif",   "telephone": "+22670000002", "role": Role.LIVREUR},
            {"username": "moussa.some",       "code_livreur": "LIV003",
             "nom": "SOME",      "prenom": "Moussa",  "telephone": "+22670000003", "role": Role.LIVREUR},
            {"username": "awa.diallo",        "code_livreur": "LIV004",
             "nom": "DIALLO",    "prenom": "Awa",     "telephone": "+22670000004", "role": Role.LIVREUR},
            {"username": "issouf.zongo",      "code_livreur": "LIV005",
             "nom": "ZONGO",     "prenom": "Issouf",  "telephone": "+22670000005", "role": Role.LIVREUR},
            {"username": "aminata.traore",    "code_livreur": None,
             "nom": "TRAORE",    "prenom": "Aminata", "telephone": "+22670000010", "role": Role.SUPERVISEUR},
        ]
        for c in comptes:
            user, created = Utilisateur.objects.get_or_create(
                username=c["username"],
                defaults={
                    "code_livreur": c["code_livreur"],
                    "first_name":   c["prenom"],
                    "last_name":    c["nom"],
                    "telephone":    c["telephone"],
                    "role":         c["role"],
                },
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()
                self.stdout.write(f"  + Utilisateur créé : {user.username} ({user.role})")
            else:
                self.stdout.write(f"  = Utilisateur existant : {user.username}")

    def _creer_vehicules(self):
        """WHAT : Crée 5 véhicules de livraison de types variés."""
        for immat, type_v, cap in [
            ("11-AB-1234", "Camion 3.5T",   200),
            ("11-CD-5678", "Camion 7T",      400),
            ("11-EF-9012", "Camion 3.5T",   200),
            ("11-GH-3456", "Camion 5T",      300),
            ("11-IJ-7890", "Moto-tricycle",   80),
        ]:
            _, created = Vehicule.objects.get_or_create(
                immatriculation=immat,
                defaults={"type": type_v, "capacite": cap},
            )
            if created:
                self.stdout.write(f"  + Véhicule créé : {immat}")

    def _creer_articles(self):
        """
        Crée 6 articles gaz : 3 emballages vides (E*) et 3 gaz plein (G*).
        Les emballages vides n'ont pas de valeur marchande
             de gaz : seule la consignation (caution sur l'emballage) est facturée.
        La commande generer_programmes_du_jour
             filtre les articles G* pour les RESTITUTION : les E* ne sont pas
             planifiés (quantités de collecte imprévues).
        """
        emballages = [
            ("E06BI", "Emballages de 6 kg à clapet", TypeEmballage.B6,    "0",     "15000"),
            ("E1250", "Emballages de 12,5 kg",        TypeEmballage.B12_5, "0",     "25000"),
            ("E3800", "Emballages de 38 kg",           TypeEmballage.B38,   "0",     "50000"),
        ]
        gaz_plein = [
            ("G06BI", "Gaz emballé de 6 kg",    TypeEmballage.B6,    "3500",  "15000"),
            ("G1250", "Gaz emballé de 12,5 kg", TypeEmballage.B12_5, "6500",  "25000"),
            ("G3800", "Gaz emballé de 38 kg",   TypeEmballage.B38,   "20000", "50000"),
        ]
        for code, libelle, emb, prix, consign in emballages + gaz_plein:
            _, created = Article.objects.get_or_create(
                code_x3=code,
                defaults={
                    "libelle":              libelle,
                    "type_emballage":       emb,
                    "prix_unitaire":        Decimal(prix),
                    "montant_consignation": Decimal(consign),
                },
            )
            if created:
                self.stdout.write(f"  + Article créé : {code}")

    def _creer_clients(self):
        """WHAT : Crée 15 clients (dépôts, revendeurs, gros clients) à Ouagadougou."""
        clients_data = [
            ("CLI0001", "Boutique Sankariare",    TypeClient.REVENDEUR,   "+22625300001"),
            ("CLI0002", "Dépôt Pissy",            TypeClient.DEPOT,       "+22625300002"),
            ("CLI0003", "Restaurant Belko",       TypeClient.GROS_CLIENT, "+22625300003"),
            ("CLI0004", "Station Hamdalaye",      TypeClient.REVENDEUR,   "+22625300004"),
            ("CLI0005", "Mini-marché Tanghin",    TypeClient.REVENDEUR,   "+22625300005"),
            ("CLI0006", "Hôtel Azalai",           TypeClient.GROS_CLIENT, "+22625300006"),
            ("CLI0007", "Dépôt Koulouba",         TypeClient.DEPOT,       "+22625300007"),
            ("CLI0008", "Boulangerie Naaba",      TypeClient.REVENDEUR,   "+22625300008"),
            ("CLI0009", "Supérette Wemtenga",     TypeClient.REVENDEUR,   "+22625300009"),
            ("CLI0010", "Cafétéria Yalgado",      TypeClient.GROS_CLIENT, "+22625300010"),
            ("CLI0011", "Dépôt Gounghin",         TypeClient.DEPOT,       "+22625300011"),
            ("CLI0012", "Maquis Laafi",           TypeClient.GROS_CLIENT, "+22625300012"),
            ("CLI0013", "Épicerie Marché Pissy",  TypeClient.REVENDEUR,   "+22625300013"),
            ("CLI0014", "Dépôt Zone du Bois",     TypeClient.DEPOT,       "+22625300014"),
            ("CLI0015", "Hôtel Palm Beach",       TypeClient.GROS_CLIENT, "+22625300015"),
        ]
        clients = {}
        for code, rs, tc, tel in clients_data:
            client, created = Client.objects.get_or_create(
                code_x3=code,
                defaults={"raison_sociale": rs, "type_client": tc, "telephone": tel},
            )
            clients[code] = client
            if created:
                self.stdout.write(f"  + Client créé : {code} - {rs}")
        return clients

    def _creer_plvs(self, clients):
        """
        Crée 25 PLVs géolocalisés à Ouagadougou (Point WGS84).
        Permet de corriger les coordonnées d'un PLV
             existant en rejouant seed_demo sans --reset (utile lors des démos).
        """
        # Tuple : (client, code_plv, libelle, adresse, lng, lat)
        # Préfixe PLVO = zone Ouagadougou
        plvs = [
            (clients["CLI0001"], "PLVO101", "Boutique Sankariare",   "Av. Yennenga",           -1.5236, 12.3650),
            (clients["CLI0001"], "PLVO102", "Boutique Sankariare",   "Av. Yennenga",           -1.5210, 12.3680),
            (clients["CLI0002"], "PLVO103", "Dépôt Pissy",           "Secteur 17",             -1.5680, 12.3450),
            (clients["CLI0002"], "PLVO104", "Dépôt Pissy",           "Secteur 17",             -1.5660, 12.3430),
            (clients["CLI0003"], "PLVO105", "Restaurant Belko",      "Zone du Bois",           -1.5050, 12.3720),
            (clients["CLI0003"], "PLVO106", "Restaurant Belko",      "Zone du Bois",           -1.5020, 12.3750),
            (clients["CLI0004"], "PLVO107", "Station Hamdalaye",     "Av. Kadiogo",            -1.5110, 12.3800),
            (clients["CLI0004"], "PLVO108", "Station Hamdalaye",     "Av. Kadiogo",            -1.5090, 12.3820),
            (clients["CLI0005"], "PLVO109", "Mini-marché Tanghin",   "Rue Tanghin",            -1.5300, 12.3950),
            (clients["CLI0006"], "PLVO110", "Hôtel Azalai",          "Av. Dimdolobsom",        -1.5340, 12.3620),
            (clients["CLI0006"], "PLVO111", "Hôtel Azalai",          "Av. Dimdolobsom",        -1.5360, 12.3610),
            (clients["CLI0007"], "PLVO112", "Dépôt Koulouba",        "Rte Ouaga 2000",         -1.5420, 12.3480),
            (clients["CLI0007"], "PLVO113", "Dépôt Koulouba",        "Rte Ouaga 2000",         -1.5440, 12.3460),
            (clients["CLI0008"], "PLVO114", "Boulangerie Naaba",     "Secteur 15",             -1.5500, 12.3550),
            (clients["CLI0009"], "PLVO115", "Supérette Wemtenga",    "Rue Wemtenga",           -1.4950, 12.3700),
            (clients["CLI0009"], "PLVO116", "Supérette Wemtenga",    "Rue Wemtenga",           -1.4920, 12.3720),
            (clients["CLI0010"], "PLVO117", "Cafétéria Yalgado",     "CHU Yalgado Ouédraogo",  -1.5170, 12.3740),
            (clients["CLI0011"], "PLVO118", "Dépôt Gounghin",        "Secteur 14",             -1.5400, 12.3580),
            (clients["CLI0011"], "PLVO119", "Dépôt Gounghin",        "Secteur 14",             -1.5380, 12.3560),
            (clients["CLI0012"], "PLVO120", "Maquis Laafi",          "Av. Kwame Nkrumah",      -1.5000, 12.3660),
            (clients["CLI0013"], "PLVO121", "Épicerie Marché Pissy", "Marché de Pissy",        -1.5620, 12.3490),
            (clients["CLI0014"], "PLVO122", "Dépôt Zone du Bois",    "Zone du Bois",           -1.5080, 12.3760),
            (clients["CLI0014"], "PLVO123", "Dépôt Zone du Bois",    "Zone du Bois",           -1.5060, 12.3780),
            (clients["CLI0015"], "PLVO124", "Hôtel Palm Beach",      "Av. de la Nation",       -1.5250, 12.3900),
            (clients["CLI0015"], "PLVO125", "Hôtel Palm Beach",      "Av. de la Nation",       -1.5230, 12.3920),
        ]
        for client, code_plv, libelle, adresse, lng, lat in plvs:
            _, created = Plv.objects.update_or_create(
                code_plv=code_plv,
                defaults={
                    "client":       client,
                    "libelle":      libelle,
                    "adresse":      adresse,
                    "localisation": Point(lng, lat, srid=4326),
                    "statut":       StatutPlv.ACTIF,
                },
            )
            if created:
                self.stdout.write(f"  + PLV créé : {code_plv} : {libelle}")
