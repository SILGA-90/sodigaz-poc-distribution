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
                "username": "adama.l", "code_livreur": "LIV001",
                "nom": "OUEDRAOGO", "prenom": "Adama",
                "telephone": "+22670000001", "role": Role.LIVREUR,
            },
            {
                "username": "salif.l", "code_livreur": "LIV002",
                "nom": "KABORE", "prenom": "Salif",
                "telephone": "+22670000002", "role": Role.LIVREUR,
            },
            {
                "username": "aminata.s", "code_livreur": None,
                "nom": "TRAORE", "prenom": "Aminata",
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
            ("11-AB-1234", "Camion 3.5T", 200),
            ("11-CD-5678", "Camion 7T", 400),
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
            ("CLI0001", "Boutique Sankariare", TypeClient.REVENDEUR, "+22625300001"),
            ("CLI0002", "Depot Pissy", TypeClient.DEPOT, "+22625300002"),
            ("CLI0003", "Restaurant Belko", TypeClient.GROS_CLIENT, "+22625300003"),
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
        plvs = [
            (clients["CLI0001"], "Sankariare - face station", "Av. Yennenga", -1.5236, 12.3650),
            (clients["CLI0001"], "Sankariare - magasin secondaire", "Av. Yennenga", -1.5210, 12.3680),
            (clients["CLI0002"], "Depot Pissy entree principale", "Secteur 17", -1.5680, 12.3450),
            (clients["CLI0003"], "Restaurant Belko cour arriere", "Zone du Bois", -1.5050, 12.3720),
            (clients["CLI0003"], "Restaurant Belko annexe", "Zone du Bois", -1.5020, 12.3750),
        ]
        for client, libelle, adresse, lng, lat in plvs:
            _, created = Plv.objects.get_or_create(
                libelle=libelle,
                defaults={
                    "client": client,
                    "adresse": adresse,
                    "localisation": Point(lng, lat, srid=4326),
                    "statut": StatutPlv.ACTIF,
                },
            )
            if created:
                self.stdout.write(f"  + PLV cree : {libelle}")
