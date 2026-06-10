"""Commande de peuplement initial du POC."""
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
    Produit,
    Programme,
    StatutPlv,
    TypeClient,
    TypeEmballage,
    Vehicule,
)


DEMO_PASSWORD = "demo1234"


class Command(BaseCommand):
    help = "Peuple la base avec un jeu de donnees de demonstration."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Supprime les donnees de demo existantes avant de creer.",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            self.stdout.write(self.style.WARNING("Reset des donnees de demo..."))
            # Ordre imposé par les PROTECT : feuilles d'abord, racines en dernier.
            Photo.objects.all().delete()
            LigneOperation.objects.all().delete()
            Anomalie.objects.all().delete()
            Operation.objects.all().delete()
            LigneProgramme.objects.all().delete()
            Etape.objects.all().delete()
            Programme.objects.all().delete()
            Plv.objects.all().delete()
            Client.objects.all().delete()
            Produit.objects.all().delete()
            Vehicule.objects.all().delete()
            Utilisateur.objects.filter(code_livreur__startswith="LIV").delete()
            Utilisateur.objects.filter(username__in=["aminata.s"]).delete()

        with transaction.atomic():
            self._creer_utilisateurs()
            self._creer_vehicules()
            self._creer_produits()
            clients = self._creer_clients()
            self._creer_plvs(clients)

        self.stdout.write(self.style.SUCCESS("\nSeed termine."))
        self.stdout.write(
            self.style.NOTICE(
                f"\nMots de passe des comptes demo : {DEMO_PASSWORD}\n"
            )
        )

    def _creer_utilisateurs(self):
        comptes = [
            {
                "username": "adama.l",   "code_livreur": "LIV001",
                "nom": "OUEDRAOGO", "prenom": "Adama",
                "telephone": "+22670000001", "role": Role.LIVREUR,
            },
            {
                "username": "salif.l",   "code_livreur": "LIV002",
                "nom": "KABORE",    "prenom": "Salif",
                "telephone": "+22670000002", "role": Role.LIVREUR,
            },
            {
                "username": "moussa.l",  "code_livreur": "LIV003",
                "nom": "SOME",      "prenom": "Moussa",
                "telephone": "+22670000003", "role": Role.LIVREUR,
            },
            {
                "username": "awa.l",     "code_livreur": "LIV004",
                "nom": "DIALLO",    "prenom": "Awa",
                "telephone": "+22670000004", "role": Role.LIVREUR,
            },
            {
                "username": "issouf.l",  "code_livreur": "LIV005",
                "nom": "ZONGO",     "prenom": "Issouf",
                "telephone": "+22670000005", "role": Role.LIVREUR,
            },
            {
                "username": "aminata.s", "code_livreur": None,
                "nom": "TRAORE",    "prenom": "Aminata",
                "telephone": "+22670000010", "role": Role.SUPERVISEUR,
            },
        ]
        for c in comptes:
            user, created = Utilisateur.objects.get_or_create(
                username=c["username"],
                defaults={
                    "code_livreur": c["code_livreur"],
                    "first_name": c["prenom"],
                    "last_name": c["nom"],
                    "telephone": c["telephone"],
                    "role": c["role"],
                },
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()
                self.stdout.write(f"  + Utilisateur cree : {user.username} ({user.role})")
            else:
                self.stdout.write(f"  = Utilisateur existant : {user.username}")

    def _creer_vehicules(self):
        for immat, type_v, cap in [
            ("11-AB-1234", "Camion 3.5T",      200),
            ("11-CD-5678", "Camion 7T",         400),
            ("11-EF-9012", "Camion 3.5T",      200),
            ("11-GH-3456", "Camion 5T",         300),
            ("11-IJ-7890", "Moto-tricycle",      80),
        ]:
            _, created = Vehicule.objects.get_or_create(
                immatriculation=immat,
                defaults={"type": type_v, "capacite": cap},
            )
            if created:
                self.stdout.write(f"  + Vehicule cree : {immat}")

    def _creer_produits(self):
        # Emballages vides (articles E* Sage X3) — utilisés en COLLECTE.
        # prix_unitaire = 0 : pas de facturation gaz sur une bouteille vide.
        emballages = [
            ("E06BI", "Emballages de 6 kg à clapet", TypeEmballage.B6,    "0",     "15000"),
            ("E1250", "Emballages de 12,5 kg",        TypeEmballage.B12_5, "0",     "25000"),
            ("E3800", "Emballages de 38 kg",           TypeEmballage.B38,   "0",     "50000"),
        ]
        # Gaz emballé (articles G* Sage X3) — utilisés en RESTITUTION.
        # prix_unitaire = prix de la recharge gaz uniquement (consignation déjà réglée à part).
        gaz_plein = [
            ("G06BI", "Gaz emballé de 6 kg",    TypeEmballage.B6,    "3500",  "15000"),
            ("G1250", "Gaz emballé de 12,5 kg", TypeEmballage.B12_5, "6500",  "25000"),
            ("G3800", "Gaz emballé de 38 kg",   TypeEmballage.B38,   "20000", "50000"),
        ]
        for code, libelle, emb, prix, consign in emballages + gaz_plein:
            _, created = Produit.objects.get_or_create(
                code_x3=code,
                defaults={
                    "libelle": libelle,
                    "type_emballage": emb,
                    "prix_unitaire": Decimal(prix),
                    "montant_consignation": Decimal(consign),
                },
            )
            if created:
                self.stdout.write(f"  + Produit cree : {code}")

    def _creer_clients(self):
        clients_data = [
            ("CLI0001", "Boutique Sankariare",    TypeClient.REVENDEUR,   "+22625300001"),
            ("CLI0002", "Depot Pissy",            TypeClient.DEPOT,       "+22625300002"),
            ("CLI0003", "Restaurant Belko",       TypeClient.GROS_CLIENT, "+22625300003"),
            ("CLI0004", "Station Hamdalaye",      TypeClient.REVENDEUR,   "+22625300004"),
            ("CLI0005", "Mini-marche Tanghin",    TypeClient.REVENDEUR,   "+22625300005"),
            ("CLI0006", "Hotel Azalai",           TypeClient.GROS_CLIENT, "+22625300006"),
            ("CLI0007", "Depot Koulouba",         TypeClient.DEPOT,       "+22625300007"),
            ("CLI0008", "Boulangerie Naaba",      TypeClient.REVENDEUR,   "+22625300008"),
            ("CLI0009", "Superette Wemtenga",     TypeClient.REVENDEUR,   "+22625300009"),
            ("CLI0010", "Cafeteria Yalgado",      TypeClient.GROS_CLIENT, "+22625300010"),
            ("CLI0011", "Depot Gounghin",         TypeClient.DEPOT,       "+22625300011"),
            ("CLI0012", "Maquis Laafi",           TypeClient.GROS_CLIENT, "+22625300012"),
            ("CLI0013", "Epicerie Marche Pissy",  TypeClient.REVENDEUR,   "+22625300013"),
            ("CLI0014", "Depot Zone du Bois",     TypeClient.DEPOT,       "+22625300014"),
            ("CLI0015", "Hotel Palm Beach",       TypeClient.GROS_CLIENT, "+22625300015"),
        ]
        clients = {}
        for code, rs, tc, tel in clients_data:
            client, created = Client.objects.get_or_create(
                code_x3=code,
                defaults={"raison_sociale": rs, "type_client": tc, "telephone": tel},
            )
            clients[code] = client
            if created:
                self.stdout.write(f"  + Client cree : {code} - {rs}")
        return clients

    def _creer_plvs(self, clients):
        # Tuple : (client, code_plv, libelle, adresse, lng, lat)
        # Le libelle = nom de l'établissement ; le code_plv distingue les points du même client.
        # Préfixe O = zone Ouagadougou / B = zone Bobo Dioulasso
        plvs = [
            # CLI0001 — Boutique Sankariare (2 PLV)
            (clients["CLI0001"], "PLVO101", "Boutique Sankariare",   "Av. Yennenga",       -1.5236, 12.3650),
            (clients["CLI0001"], "PLVO102", "Boutique Sankariare",   "Av. Yennenga",       -1.5210, 12.3680),
            # CLI0002 — Depot Pissy (2 PLV)
            (clients["CLI0002"], "PLVO103", "Depot Pissy",           "Secteur 17",         -1.5680, 12.3450),
            (clients["CLI0002"], "PLVO104", "Depot Pissy",           "Secteur 17",         -1.5660, 12.3430),
            # CLI0003 — Restaurant Belko (2 PLV)
            (clients["CLI0003"], "PLVO105", "Restaurant Belko",      "Zone du Bois",       -1.5050, 12.3720),
            (clients["CLI0003"], "PLVO106", "Restaurant Belko",      "Zone du Bois",       -1.5020, 12.3750),
            # CLI0004 — Station Hamdalaye (2 PLV)
            (clients["CLI0004"], "PLVO107", "Station Hamdalaye",     "Av. Kadiogo",        -1.5110, 12.3800),
            (clients["CLI0004"], "PLVO108", "Station Hamdalaye",     "Av. Kadiogo",        -1.5090, 12.3820),
            # CLI0005 — Mini-marche Tanghin (1 PLV)
            (clients["CLI0005"], "PLVO109", "Mini-marche Tanghin",   "Rue Tanghin",        -1.5300, 12.3950),
            # CLI0006 — Hotel Azalai (2 PLV)
            (clients["CLI0006"], "PLVO110", "Hotel Azalai",          "Av. Dimdolobsom",    -1.5340, 12.3620),
            (clients["CLI0006"], "PLVO111", "Hotel Azalai",          "Av. Dimdolobsom",    -1.5360, 12.3610),
            # CLI0007 — Depot Koulouba (2 PLV)
            (clients["CLI0007"], "PLVO112", "Depot Koulouba",        "Rte Ouaga 2000",     -1.5420, 12.3480),
            (clients["CLI0007"], "PLVO113", "Depot Koulouba",        "Rte Ouaga 2000",     -1.5440, 12.3460),
            # CLI0008 — Boulangerie Naaba (1 PLV)
            (clients["CLI0008"], "PLVO114", "Boulangerie Naaba",     "Secteur 15",         -1.5500, 12.3550),
            # CLI0009 — Superette Wemtenga (2 PLV)
            (clients["CLI0009"], "PLVO115", "Superette Wemtenga",    "Rue Wemtenga",       -1.4950, 12.3700),
            (clients["CLI0009"], "PLVO116", "Superette Wemtenga",    "Rue Wemtenga",       -1.4920, 12.3720),
            # CLI0010 — Cafeteria Yalgado (1 PLV)
            (clients["CLI0010"], "PLVO117", "Cafeteria Yalgado",     "CHU Yalgado Ouedraogo", -1.5170, 12.3740),
            # CLI0011 — Depot Gounghin (2 PLV)
            (clients["CLI0011"], "PLVO118", "Depot Gounghin",        "Secteur 14",         -1.5400, 12.3580),
            (clients["CLI0011"], "PLVO119", "Depot Gounghin",        "Secteur 14",         -1.5380, 12.3560),
            # CLI0012 — Maquis Laafi (1 PLV)
            (clients["CLI0012"], "PLVO120", "Maquis Laafi",          "Av. Kwame Nkrumah",  -1.5000, 12.3660),
            # CLI0013 — Epicerie Marche Pissy (1 PLV)
            (clients["CLI0013"], "PLVO121", "Epicerie Marche Pissy", "Marche de Pissy",    -1.5620, 12.3490),
            # CLI0014 — Depot Zone du Bois (2 PLV)
            (clients["CLI0014"], "PLVO122", "Depot Zone du Bois",    "Zone du Bois",       -1.5080, 12.3760),
            (clients["CLI0014"], "PLVO123", "Depot Zone du Bois",    "Zone du Bois",       -1.5060, 12.3780),
            # CLI0015 — Hotel Palm Beach (2 PLV)
            (clients["CLI0015"], "PLVO124", "Hotel Palm Beach",      "Av. de la Nation",   -1.5250, 12.3900),
            (clients["CLI0015"], "PLVO125", "Hotel Palm Beach",      "Av. de la Nation",   -1.5230, 12.3920),
        ]
        for client, code_plv, libelle, adresse, lng, lat in plvs:
            _, created = Plv.objects.update_or_create(
                code_plv=code_plv,
                defaults={
                    "client": client,
                    "libelle": libelle,
                    "adresse": adresse,
                    "localisation": Point(lng, lat, srid=4326),
                    "statut": StatutPlv.ACTIF,
                },
            )
            if created:
                self.stdout.write(f"  + PLV cree : {code_plv} — {libelle}")
