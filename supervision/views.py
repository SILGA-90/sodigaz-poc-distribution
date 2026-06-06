"""Vues de l'interface de supervision logistique."""
from datetime import date as date_cls

from django.contrib.auth import logout as django_logout
from django.db.models import Count, Exists, OuterRef, Q, Sum, DecimalField
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render

from accounts.models import Role, Utilisateur
from distribution.models import (
    Anomalie,
    Etape,
    LigneOperation,
    LigneProgramme,
    Operation,
    Plv,
    Programme,
    StatutAnomalie,
    StatutVisite,
)

from .decorators import superviseur_required


@superviseur_required
def dashboard(request):
    """
    Page d'accueil : carte de Ouaga + statistiques du jour.
    """
    today = date_cls.today()

    programmes_aujourdhui = Programme.objects.filter(
        date_programme=today, is_deleted=False,
    ).select_related("utilisateur", "vehicule")

    nb_programmes = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=today,
        is_deleted=False,
    )
    nb_operations = operations_aujourdhui.count()
    montant_encaisse = (
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=today,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    context = {
        "today": today,
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
    }
    return render(request, "supervision/dashboard.html", context)


@superviseur_required
def dashboard_carte_data(request):
    """
    Endpoint AJAX : renvoie les PLV et operations du jour au format GeoJSON-ish.
    Appele par la carte Leaflet.
    """
    today = date_cls.today()

    plvs = []
    for plv in (
        Plv.objects.filter(statut="ACTIF")
        .select_related("client")
        .annotate(
            visite=Exists(
                Operation.objects.filter(
                    etape__plv=OuterRef("pk"),
                    etape__programme__date_programme=today,
                    is_deleted=False,
                )
            )
        )
    ):
        plvs.append({
            "id": plv.id,
            "libelle": plv.libelle,
            "client": plv.client.raison_sociale,
            "latitude": plv.localisation.y,
            "longitude": plv.localisation.x,
            "visite": plv.visite,
        })

    operations = []
    for op in Operation.objects.filter(
        etape__programme__date_programme=today,
        is_deleted=False,
        localisation_saisie__isnull=False,
    ).select_related("etape__plv", "etape__programme__utilisateur"):
        operations.append({
            "uuid": str(op.uuid),
            "plv": op.etape.plv.libelle,
            "livreur": op.etape.programme.utilisateur.code_livreur,
            "type": op.type_operation,
            "latitude": op.localisation_saisie.y,
            "longitude": op.localisation_saisie.x,
        })

    return JsonResponse({"plvs": plvs, "operations": operations})


@superviseur_required
def dashboard_stats_data(request):
    """
    Endpoint AJAX : renvoie les 4 KPI du dashboard.
    Permet la mise a jour sans recharger toute la page.
    """
    today = date_cls.today()

    programmes_aujourdhui = Programme.objects.filter(
        date_programme=today, is_deleted=False,
    )
    nb_programmes = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=today,
        is_deleted=False,
    )
    nb_operations = operations_aujourdhui.count()
    montant_encaisse = float(
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=today,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    return JsonResponse({
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
    })



@superviseur_required
def programmes_list(request):
    today = date_cls.today()
    date_str = request.GET.get("date")
    if date_str:
        try:
            from datetime import datetime
            date_filter = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            date_filter = today
    else:
        date_filter = today

    programmes = (
        Programme.objects
        .filter(date_programme=date_filter, is_deleted=False)
        .select_related("utilisateur", "vehicule")
        .annotate(
            total_etapes=Count("etapes", filter=Q(etapes__is_deleted=False)),
            etapes_visitees=Count(
                "etapes",
                filter=Q(etapes__is_deleted=False, etapes__statut_visite=StatutVisite.VISITEE),
            ),
            etapes_echec=Count(
                "etapes",
                filter=Q(etapes__is_deleted=False, etapes__statut_visite="ECHEC"),
            ),
        )
        .order_by("type_programme", "utilisateur__code_livreur")
    )

    return render(request, "supervision/programmes_list.html", {
        "programmes": programmes,
        "date_filter": date_filter,
    })


@superviseur_required
def programme_detail(request, programme_id):
    programme = get_object_or_404(
        Programme.objects.select_related("utilisateur", "vehicule"),
        id=programme_id, is_deleted=False,
    )

    etapes = (
        programme.etapes
        .filter(is_deleted=False)
        .select_related("plv", "plv__client")
        .prefetch_related(
            "operations__lignes__produit",
            "operations__document_x3__bcr",
            "operations__photos",
            "lignes_prevues__produit",
        )
        .order_by("ordre_prevu")
    )

    # Reconciliation prevu / realise par etape et produit
    reconciliation = []
    for etape in etapes:
        # Agreger par produit
        produits_dict = {}
        for lp in etape.lignes_prevues.filter(is_deleted=False):
            produits_dict[lp.produit_id] = {
                "produit": lp.produit,
                "prevu": lp.quantite_prevue,
                "realise": 0,
            }
        for op in etape.operations.filter(is_deleted=False):
            for lo in op.lignes.filter(is_deleted=False):
                if lo.produit_id in produits_dict:
                    produits_dict[lo.produit_id]["realise"] += lo.quantite_realisee
                else:
                    produits_dict[lo.produit_id] = {
                        "produit": lo.produit,
                        "prevu": 0,
                        "realise": lo.quantite_realisee,
                    }
        lignes_recon = []
        for d in produits_dict.values():
            d["ecart"] = d["realise"] - d["prevu"]
            lignes_recon.append(d)
        reconciliation.append({"etape": etape, "lignes": lignes_recon})

    return render(request, "supervision/programme_detail.html", {
        "programme": programme,
        "reconciliation": reconciliation,
    })


@superviseur_required
def operations_list(request):
    today = date_cls.today()
    date_str = request.GET.get("date")
    livreur_code = request.GET.get("livreur", "").strip()

    if date_str:
        try:
            from datetime import datetime
            date_filter = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            date_filter = today
    else:
        date_filter = today

    operations = (
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .select_related(
            "etape__plv__client",
            "etape__programme__utilisateur",
        )
        .order_by("-date_heure")
    )
    if livreur_code:
        operations = operations.filter(
            etape__programme__utilisateur__code_livreur=livreur_code
        )

    livreurs = Utilisateur.objects.filter(role=Role.LIVREUR, is_active=True).order_by("code_livreur")

    total_montant = operations.aggregate(
        total=Coalesce(Sum("montant_total"), 0, output_field=DecimalField())
    )["total"]

    return render(request, "supervision/operations_list.html", {
        "operations": operations,
        "date_filter": date_filter,
        "livreur_code": livreur_code,
        "livreurs": livreurs,
        "total_montant": total_montant,
    })


@superviseur_required
def anomalies_list(request):
    statut_filter = request.GET.get("statut", "OUVERTE")
    anomalies_qs = (
        Anomalie.objects
        .filter(is_deleted=False)
        .select_related("programme__utilisateur", "plv__client")
        .order_by("-date_heure")
    )
    if statut_filter and statut_filter != "TOUS":
        anomalies_qs = anomalies_qs.filter(statut=statut_filter)

    return render(request, "supervision/anomalies_list.html", {
        "anomalies": anomalies_qs,
        "statut_filter": statut_filter,
    })


@superviseur_required
def changer_statut_anomalie(request, anomalie_id):
    """Met à jour le statut d'une anomalie (action superviseur)."""
    if request.method == "POST":
        nouveau_statut = request.POST.get("statut", "")
        if nouveau_statut in ("OUVERTE", "EN_TRAITEMENT", "RESOLUE"):
            Anomalie.objects.filter(id=anomalie_id, is_deleted=False).update(
                statut=nouveau_statut
            )
    return redirect("supervision:anomalies")


def logout_view(request):
    django_logout(request)
    return redirect("supervision:login")
