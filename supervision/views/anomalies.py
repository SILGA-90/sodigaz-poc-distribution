"""Vues des anomalies terrain (liste, détail, changement de statut / gravité)."""
from django.shortcuts import get_object_or_404, redirect, render

from distribution.models import Anomalie

from ..decorators import superviseur_required
from ._base import _get_date_filter


@superviseur_required
def anomalies_list(request):
    statut_filter = request.GET.get("statut", "OUVERTE")
    gravite_filter = request.GET.get("gravite", "").strip()

    anomalies_qs = (
        Anomalie.objects
        .filter(is_deleted=False)
        .select_related("programme__utilisateur", "plv__client")
        .order_by("-date_heure")
    )
    if statut_filter and statut_filter != "TOUS":
        anomalies_qs = anomalies_qs.filter(statut=statut_filter)
    if gravite_filter in ("ELEVEE", "MOYENNE", "FAIBLE"):
        anomalies_qs = anomalies_qs.filter(gravite=gravite_filter)

    return render(request, "supervision/anomalies_list.html", {
        "anomalies": anomalies_qs,
        "statut_filter": statut_filter,
        "gravite_filter": gravite_filter,
    })


@superviseur_required
def anomalie_detail(request, anomalie_id):
    anomalie = get_object_or_404(
        Anomalie.objects
        .select_related("programme__utilisateur", "plv__client")
        .prefetch_related("photos"),
        id=anomalie_id,
        is_deleted=False,
    )
    return render(request, "supervision/anomalie_detail.html", {"anomalie": anomalie})


@superviseur_required
def changer_statut_anomalie(request, anomalie_id):
    """Met à jour le statut d'une anomalie (action superviseur)."""
    if request.method == "POST":
        nouveau_statut = request.POST.get("statut", "")
        if nouveau_statut in ("OUVERTE", "EN_TRAITEMENT", "RESOLUE"):
            Anomalie.objects.filter(id=anomalie_id, is_deleted=False).update(
                statut=nouveau_statut
            )
    referer = request.META.get("HTTP_REFERER")
    return redirect(referer if referer else "supervision:anomalies")


@superviseur_required
def changer_gravite_anomalie(request, anomalie_id):
    """Reclassifie la gravité d'une anomalie (action superviseur uniquement)."""
    if request.method == "POST":
        nouvelle_gravite = request.POST.get("gravite", "")
        if nouvelle_gravite in ("FAIBLE", "MOYENNE", "ELEVEE"):
            Anomalie.objects.filter(id=anomalie_id, is_deleted=False).update(
                gravite=nouvelle_gravite
            )
    referer = request.META.get("HTTP_REFERER")
    return redirect(referer if referer else "supervision:anomalies")
