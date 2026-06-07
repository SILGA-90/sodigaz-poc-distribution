"""Vues du tableau de bord (carte, KPI, activité)."""
from datetime import date as date_cls

from django.db.models import Count, Exists, OuterRef, Sum
from django.db.models.functions import Coalesce, ExtractHour
from django.http import JsonResponse
from django.shortcuts import render

from distribution.models import (
    Anomalie, LigneOperation, LigneProgramme,
    Operation, Plv, Produit, Programme, StatutAnomalie,
)

from ..decorators import superviseur_required
from ._base import _get_date_filter


@superviseur_required
def dashboard(request):
    date_filter = _get_date_filter(request, write_session=True)

    programmes_aujourdhui = Programme.objects.filter(
        date_programme=date_filter, is_deleted=False,
    ).select_related("utilisateur", "vehicule")

    nb_programmes = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=date_filter,
        is_deleted=False,
    )
    nb_operations = operations_aujourdhui.count()
    montant_encaisse = (
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=date_filter,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    anomalies_elevees = (
        Anomalie.objects
        .filter(
            programme__date_programme=date_filter,
            gravite="ELEVEE",
            statut__in=("OUVERTE", "EN_TRAITEMENT"),
            is_deleted=False,
        )
        .select_related("programme__utilisateur", "plv")
        .order_by("-date_heure")
    )

    return render(request, "supervision/dashboard.html", {
        "today": date_filter,
        "date_filter": date_filter,
        "is_today": date_filter == date_cls.today(),
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
        "anomalies_elevees": anomalies_elevees,
    })


@superviseur_required
def dashboard_carte_data(request):
    """AJAX : PLV actives + opérations géolocalisées du jour (pour Leaflet)."""
    date_filter = _get_date_filter(request)

    plvs = []
    for plv in (
        Plv.objects.filter(statut="ACTIF")
        .select_related("client")
        .annotate(
            visite=Exists(
                Operation.objects.filter(
                    etape__plv=OuterRef("pk"),
                    etape__programme__date_programme=date_filter,
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
    for op in (
        Operation.objects
        .filter(
            etape__programme__date_programme=date_filter,
            is_deleted=False,
            localisation_saisie__isnull=False,
        )
        .select_related("etape__plv", "etape__programme__utilisateur")
        .order_by("date_heure")
    ):
        operations.append({
            "uuid": str(op.uuid),
            "plv": op.etape.plv.libelle,
            "livreur": op.etape.programme.utilisateur.code_livreur,
            "type": op.type_operation,
            "latitude": op.localisation_saisie.y,
            "longitude": op.localisation_saisie.x,
            "timestamp": op.date_heure.isoformat(),
            "ordre_prevu": op.etape.ordre_prevu,
        })

    return JsonResponse({"plvs": plvs, "operations": operations})


@superviseur_required
def dashboard_stats_data(request):
    """AJAX : 4 KPI du dashboard (rechargement sans rafraîchir la page)."""
    date_filter = _get_date_filter(request)

    programmes_aujourdhui = Programme.objects.filter(
        date_programme=date_filter, is_deleted=False,
    )
    nb_programmes = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=date_filter,
        is_deleted=False,
    )
    nb_operations = operations_aujourdhui.count()
    montant_encaisse = float(
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=date_filter,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    nb_anomalies_elevees = Anomalie.objects.filter(
        programme__date_programme=date_filter,
        gravite="ELEVEE",
        statut__in=("OUVERTE", "EN_TRAITEMENT"),
        is_deleted=False,
    ).count()

    return JsonResponse({
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
        "nb_anomalies_elevees": nb_anomalies_elevees,
    })


@superviseur_required
def dashboard_activite_data(request):
    """AJAX : nombre d'opérations par heure (conservé pour compatibilité)."""
    date_filter = _get_date_filter(request)

    rows = (
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .annotate(heure=ExtractHour("date_heure"))
        .values("heure")
        .annotate(count=Count("id"))
        .order_by("heure")
    )
    par_heure = {row["heure"]: row["count"] for row in rows}
    heures = list(range(6, 21))
    return JsonResponse({
        "labels": [f"{h:02d}h" for h in heures],
        "data": [par_heure.get(h, 0) for h in heures],
    })


@superviseur_required
def dashboard_bilan_produits_data(request):
    """
    AJAX : bilan prévu vs réalisé par produit G* pour la journée.
    Utile pour le stock, le commercial et la réconciliation des données.
    """
    date_filter = _get_date_filter(request)
    filtre = dict(
        etape__programme__date_programme=date_filter,
        etape__programme__is_deleted=False,
        is_deleted=False,
    )

    # Quantités prévues (RESTITUTION uniquement — les COLLECTE n'ont pas de LigneProgramme)
    prevus = {
        row["produit_id"]: row["qte"]
        for row in LigneProgramme.objects
        .filter(
            etape__programme__date_programme=date_filter,
            etape__programme__is_deleted=False,
            is_deleted=False,
        )
        .values("produit_id")
        .annotate(qte=Sum("quantite_prevue"))
    }

    # Quantités réalisées (toutes opérations)
    realises = {
        row["produit_id"]: row["qte"]
        for row in LigneOperation.objects
        .filter(
            operation__etape__programme__date_programme=date_filter,
            operation__etape__programme__is_deleted=False,
            is_deleted=False,
        )
        .values("produit_id")
        .annotate(qte=Sum("quantite_realisee"))
    }

    # Fusion par produit
    tous_ids = set(prevus) | set(realises)
    if not tous_ids:
        return JsonResponse({"produits": []})

    produits_map = {
        p.id: p
        for p in Produit.objects.filter(id__in=tous_ids).only("id", "code_x3", "libelle", "prix_unitaire")
    }

    result = []
    for pid in sorted(tous_ids, key=lambda i: produits_map[i].code_x3):
        prod = produits_map[pid]
        prevu = prevus.get(pid, 0)
        realise = realises.get(pid, 0)
        result.append({
            "code_x3": prod.code_x3,
            "libelle": prod.libelle,
            "prevu": prevu,
            "realise": realise,
            "ecart": realise - prevu,
            "montant": realise * int(prod.prix_unitaire or 0),
        })

    return JsonResponse({"produits": result})
