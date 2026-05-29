#!/bin/bash
# =============================================================================
# Installation du mock Sage X3 + seed + admin dans ~/sodigaz_poc
# Usage : depuis ~/sodigaz_poc, bash install_mock_x3.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : ce script doit etre execute depuis ~/sodigaz_poc"
    echo "Fais d'abord : cd ~/sodigaz_poc"
    exit 1
fi

echo ""
echo "=== Etape 1 : creation de l'arborescence mock_x3 ==="
mkdir -p mock_x3/management/commands mock_x3/migrations
touch mock_x3/__init__.py
touch mock_x3/migrations/__init__.py
touch mock_x3/management/__init__.py
touch mock_x3/management/commands/__init__.py
echo "OK"

# =============================================================================
echo ""
echo "=== Etape 2 : creation des fichiers ==="

# ----- mock_x3/apps.py -----
cat > mock_x3/apps.py << 'PYEOF'
from django.apps import AppConfig


class MockX3Config(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "mock_x3"
    verbose_name = "Simulation Sage X3"
PYEOF

# ----- mock_x3/serializers.py -----
cat > mock_x3/serializers.py << 'PYEOF'
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
PYEOF

# ----- mock_x3/views.py -----
cat > mock_x3/views.py << 'PYEOF'
"""Vues de l'API simulant Sage X3."""
from datetime import date as date_cls
from datetime import datetime

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from distribution.models import Client, Programme

from .serializers import (
    EtapeProgrammeSerializer,
    LignePrevueSerializer,
    OperationRemonteeSerializer,
    ProgrammeJourSerializer,
)


@api_view(["GET"])
@permission_classes([AllowAny])
def programme_du_jour(request):
    code_livreur = request.query_params.get("code_livreur")
    date_str = request.query_params.get("date")

    if not code_livreur:
        return Response(
            {"detail": "Parametre 'code_livreur' requis."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if date_str:
        try:
            date_prog = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response(
                {"detail": "Format de date invalide, attendu YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    else:
        date_prog = date_cls.today()

    qs = Programme.objects.filter(
        utilisateur__code_livreur=code_livreur,
        date_programme=date_prog,
        is_deleted=False,
    ).select_related("utilisateur", "vehicule")

    programmes = list(qs)
    if not programmes:
        return Response(
            {
                "detail": (
                    f"Aucun programme trouve pour le livreur {code_livreur} "
                    f"a la date {date_prog.isoformat()}."
                )
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    payload = []
    for prog in programmes:
        etapes_data = []
        etapes_qs = (
            prog.etapes.filter(is_deleted=False)
            .select_related("plv", "plv__client")
            .order_by("ordre_prevu")
        )
        for etape in etapes_qs:
            lignes_data = []
            for ligne in etape.lignes_prevues.filter(is_deleted=False).select_related("produit"):
                lignes_data.append(
                    LignePrevueSerializer(
                        {
                            "code_produit_x3": ligne.produit.code_x3,
                            "libelle_produit": ligne.produit.libelle,
                            "quantite_prevue": ligne.quantite_prevue,
                        }
                    ).data
                )

            etapes_data.append(
                EtapeProgrammeSerializer(
                    {
                        "ordre": etape.ordre_prevu,
                        "code_client_x3": etape.plv.client.code_x3,
                        "raison_sociale_client": etape.plv.client.raison_sociale,
                        "libelle_plv": etape.plv.libelle,
                        "adresse_plv": etape.plv.adresse or "",
                        "latitude": etape.plv.localisation.y,
                        "longitude": etape.plv.localisation.x,
                        "lignes_prevues": lignes_data,
                    }
                ).data
            )

        payload.append(
            ProgrammeJourSerializer(
                {
                    "numero_x3": prog.numero_x3,
                    "code_livreur": prog.utilisateur.code_livreur,
                    "date_programme": prog.date_programme,
                    "type_programme": prog.type_programme,
                    "immatriculation_vehicule": (
                        prog.vehicule.immatriculation if prog.vehicule else None
                    ),
                    "etapes": etapes_data,
                }
            ).data
        )

    return Response({"programmes": payload}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([AllowAny])
def remonter_operation(request):
    serializer = OperationRemonteeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    get_object_or_404(Client, code_x3=data["code_client_x3"])

    prefixes = {
        "COLLECTE": "BC",
        "RESTITUTION": "BR",
        "LIVRAISON_DIRECTE": "BL",
        "CONSIGNE": "BCN",
    }
    numero_bordereau = f"{prefixes[data['type_operation']]}-{data['uuid'].hex[:8].upper()}"

    return Response(
        {
            "statut": "ACCUSE_RECEPTION",
            "uuid_operation": str(data["uuid"]),
            "numero_bordereau_x3": numero_bordereau,
            "horodatage_reception": datetime.now().isoformat(),
        },
        status=status.HTTP_200_OK,
    )
PYEOF

# ----- mock_x3/urls.py -----
cat > mock_x3/urls.py << 'PYEOF'
from django.urls import path

from . import views

app_name = "mock_x3"

urlpatterns = [
    path("programmes/", views.programme_du_jour, name="programmes-du-jour"),
    path("operations-realisees/", views.remonter_operation, name="remonter-operation"),
]
PYEOF

# ----- mock_x3/management/commands/seed_demo.py -----
cat > mock_x3/management/commands/seed_demo.py << 'PYEOF'
"""Commande de peuplement initial du POC."""
from decimal import Decimal

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Role, Utilisateur
from distribution.models import (
    Client,
    Plv,
    Produit,
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
        produits = [
            ("B6-PLEINE", "Bouteille 6 kg pleine", TypeEmballage.B6, "3500", "15000"),
            ("B12-PLEINE", "Bouteille 12,5 kg pleine", TypeEmballage.B12_5, "6500", "25000"),
            ("B38-PLEINE", "Bouteille 38 kg pleine", TypeEmballage.B38, "20000", "50000"),
        ]
        for code, libelle, emb, prix, consign in produits:
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
PYEOF

# ----- mock_x3/management/commands/generer_programmes_du_jour.py -----
cat > mock_x3/management/commands/generer_programmes_du_jour.py << 'PYEOF'
"""Commande Django simulant l'export quotidien de Sage X3."""
import random
from datetime import date as date_cls
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role, Utilisateur
from distribution.models import (
    Etape,
    LigneProgramme,
    Plv,
    Produit,
    Programme,
    StatutProgramme,
    TypeProgramme,
    Vehicule,
)


class Command(BaseCommand):
    help = "Genere les programmes du jour (simulation Sage X3)."

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str,
            help="Date du programme (YYYY-MM-DD). Par defaut : aujourd'hui.")
        parser.add_argument("--livreur", type=str,
            help="Code livreur specifique. Par defaut : tous.")
        parser.add_argument("--reset", action="store_true",
            help="Supprime les programmes existants pour la date avant generation.")

    def handle(self, *args, **options):
        if options["date"]:
            try:
                date_prog = datetime.strptime(options["date"], "%Y-%m-%d").date()
            except ValueError as e:
                raise CommandError(f"Format de date invalide : {e}")
        else:
            date_prog = date_cls.today()

        livreurs_qs = Utilisateur.objects.filter(role=Role.LIVREUR, is_active=True)
        if options["livreur"]:
            livreurs_qs = livreurs_qs.filter(code_livreur=options["livreur"])
        livreurs = list(livreurs_qs)
        if not livreurs:
            raise CommandError("Aucun livreur actif trouve.")

        plvs = list(Plv.objects.filter(statut="ACTIF").select_related("client"))
        if len(plvs) < 3:
            raise CommandError(
                f"Pas assez de PLV actifs ({len(plvs)}). Lance d'abord 'seed_demo'."
            )
        vehicules = list(Vehicule.objects.filter(actif=True))
        produits = list(Produit.objects.filter(actif=True))
        if not produits:
            raise CommandError("Aucun produit actif. Lance d'abord 'seed_demo'.")

        if options["reset"]:
            n, _ = Programme.objects.filter(
                date_programme=date_prog,
                utilisateur__in=livreurs,
            ).delete()
            self.stdout.write(self.style.WARNING(f"Reset : {n} programme(s) supprime(s)."))

        compteur = 0
        with transaction.atomic():
            for i, livreur in enumerate(livreurs):
                type_prog = (
                    TypeProgramme.COLLECTE if i % 2 == 0 else TypeProgramme.RESTITUTION
                )

                if Programme.objects.filter(
                    utilisateur=livreur,
                    date_programme=date_prog,
                    type_programme=type_prog,
                ).exists():
                    self.stdout.write(
                        self.style.NOTICE(
                            f"  {livreur.code_livreur} : programme {type_prog} "
                            f"deja existant pour le {date_prog}, ignore."
                        )
                    )
                    continue

                numero_x3 = f"PRG-{date_prog.strftime('%Y%m%d')}-{livreur.code_livreur}-{type_prog[:3]}"
                vehicule = random.choice(vehicules) if vehicules else None

                programme = Programme.objects.create(
                    numero_x3=numero_x3,
                    utilisateur=livreur,
                    vehicule=vehicule,
                    date_programme=date_prog,
                    type_programme=type_prog,
                    statut=StatutProgramme.PLANIFIE,
                )

                nb_etapes = random.randint(3, min(5, len(plvs)))
                plvs_choisis = random.sample(plvs, nb_etapes)
                for ordre, plv in enumerate(plvs_choisis, start=1):
                    etape = Etape.objects.create(
                        programme=programme,
                        plv=plv,
                        ordre_prevu=ordre,
                    )
                    if type_prog == TypeProgramme.RESTITUTION:
                        nb_articles = random.randint(1, min(3, len(produits)))
                        produits_choisis = random.sample(produits, nb_articles)
                        for prod in produits_choisis:
                            LigneProgramme.objects.create(
                                etape=etape,
                                produit=prod,
                                quantite_prevue=random.randint(5, 30),
                            )

                compteur += 1
                self.stdout.write(
                    f"  {livreur.code_livreur} : {numero_x3} "
                    f"({type_prog}, {nb_etapes} etapes)"
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"\n{compteur} programme(s) genere(s) pour le {date_prog}."
            )
        )
PYEOF

# ----- distribution/admin.py -----
cat > distribution/admin.py << 'PYEOF'
"""Admin Django pour la visualisation des donnees pendant le developpement."""
from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import (
    Anomalie, Etape, LigneOperation, LigneProgramme, Operation,
    Photo, Plv, Produit, Programme, Vehicule,
)
from .models import Client as ClientModel


@admin.register(ClientModel)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("code_x3", "raison_sociale", "type_client", "actif")
    list_filter = ("type_client", "actif")
    search_fields = ("code_x3", "raison_sociale")


@admin.register(Plv)
class PlvAdmin(GISModelAdmin):
    list_display = ("libelle", "client", "statut")
    list_filter = ("statut", "client__type_client")
    search_fields = ("libelle", "client__raison_sociale")
    autocomplete_fields = ("client",)


@admin.register(Produit)
class ProduitAdmin(admin.ModelAdmin):
    list_display = ("code_x3", "libelle", "type_emballage", "prix_unitaire", "actif")
    list_filter = ("type_emballage", "actif")
    search_fields = ("code_x3", "libelle")


@admin.register(Vehicule)
class VehiculeAdmin(admin.ModelAdmin):
    list_display = ("immatriculation", "type", "capacite", "actif")
    list_filter = ("actif",)
    search_fields = ("immatriculation",)


class EtapeInline(admin.TabularInline):
    model = Etape
    extra = 0
    fields = ("ordre_prevu", "plv", "statut_visite")
    autocomplete_fields = ("plv",)


@admin.register(Programme)
class ProgrammeAdmin(admin.ModelAdmin):
    list_display = (
        "numero_x3", "date_programme", "utilisateur", "type_programme",
        "statut", "is_deleted",
    )
    list_filter = ("type_programme", "statut", "date_programme")
    search_fields = ("numero_x3", "utilisateur__username", "utilisateur__code_livreur")
    autocomplete_fields = ("utilisateur", "vehicule")
    inlines = [EtapeInline]


class LigneProgrammeInline(admin.TabularInline):
    model = LigneProgramme
    extra = 0


@admin.register(Etape)
class EtapeAdmin(admin.ModelAdmin):
    list_display = ("programme", "ordre_prevu", "plv", "statut_visite")
    list_filter = ("statut_visite",)
    autocomplete_fields = ("programme", "plv")
    inlines = [LigneProgrammeInline]


class LigneOperationInline(admin.TabularInline):
    model = LigneOperation
    extra = 0


class PhotoInline(admin.TabularInline):
    model = Photo
    extra = 0
    fk_name = "operation"
    fields = ("type_photo", "fichier", "date_heure")


@admin.register(Operation)
class OperationAdmin(GISModelAdmin):
    list_display = (
        "uuid", "etape", "type_operation", "sous_type", "date_heure",
        "montant_total", "est_encaissee",
    )
    list_filter = ("type_operation", "sous_type", "est_encaissee", "mode_paiement")
    search_fields = ("uuid",)
    autocomplete_fields = ("etape",)
    inlines = [LigneOperationInline, PhotoInline]
    readonly_fields = ("last_modified",)


@admin.register(Anomalie)
class AnomalieAdmin(GISModelAdmin):
    list_display = ("uuid", "programme", "type_anomalie", "gravite", "statut", "date_heure")
    list_filter = ("statut", "gravite")
    search_fields = ("uuid", "type_anomalie", "description")
    autocomplete_fields = ("programme", "plv")


@admin.register(Photo)
class PhotoAdmin(GISModelAdmin):
    list_display = ("uuid", "type_photo", "operation", "anomalie", "date_heure")
    list_filter = ("type_photo",)
PYEOF

echo "OK"

# =============================================================================
echo ""
echo "=== Etape 3 : modification de config/settings.py ==="
python3 << 'PYEOF'
import re
from pathlib import Path

settings_path = Path("config/settings.py")
content = settings_path.read_text()

if '"mock_x3"' not in content:
    content = re.sub(
        r'("distribution",\s*\n)(\])',
        r'\1    "mock_x3",\n\2',
        content,
    )
    settings_path.write_text(content)
    print("OK : mock_x3 ajoute aux INSTALLED_APPS")
else:
    print("Deja present : mock_x3 dans INSTALLED_APPS")
PYEOF

# =============================================================================
echo ""
echo "=== Etape 4 : modification de config/urls.py ==="
cat > config/urls.py << 'PYEOF'
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/mock-x3/", include("mock_x3.urls")),
]
PYEOF
echo "OK"

# =============================================================================
echo ""
echo "=============================================="
echo "INSTALLATION TERMINEE."
echo "=============================================="
echo ""
echo "Etapes suivantes a executer :"
echo ""
echo "  1. python manage.py seed_demo"
echo "  2. python manage.py generer_programmes_du_jour"
echo "  3. python manage.py runserver"
echo ""
echo "Puis tester (dans un autre terminal) :"
echo "  curl 'http://localhost:8000/api/mock-x3/programmes/?code_livreur=LIV001'"
echo ""
