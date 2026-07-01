"""
Vues transverses de supervision : déconnexion et rapport journalier.

Ce module regroupe les vues qui ne rentrent pas dans les autres modules :
  - logout_view()     : déconnexion de la session Django
  - rapport_journee() : rapport consolidé par livreur pour une journée, imprimable

Évite d'alourdir les autres modules avec des vues qui n'ont
pas de relation directe avec leur domaine (programmes, opérations...).
"""
from datetime import date, timedelta

from django.contrib.auth import logout as django_logout
from django.db.models import Count, DecimalField, Q, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import redirect, render

from distribution.models import Operation, Programme, StatutVisite

from ..decorators import superviseur_required
from ._base import _get_date_filter


def logout_view(request):
    """
    Déconnecte l'utilisateur et redirige vers la page de login.
    La déconnexion invalide la session Django côté serveur : indispensable
    pour que le token CSRF et les données de session soient effacés.
    Simple redirect GET après logout (pas de POST ici : le formulaire de
    confirmation est dans le modal Bootstrap du template base.html).
    """
    django_logout(request)
    return redirect("supervision:login")


@superviseur_required
def rapport_journee(request):
    """
    Vue consolidée par livreur pour une journée donnée : imprimable.
    Présente les agrégats de chaque programme : étapes, opérations,
    montants et anomalies.

    Mélanger les annotations
         COUNT étapes/anomalies et SUM montants dans une seule requête crée des
         inflations de valeurs dues aux JOIN multiples (chaque JOIN multiplie les
         lignes). On fait deux requêtes séparées et on fusionne en Python via
         op_by_prog.

    L'annotation .annotate() sur
         Programme peut traverser plusieurs relations en même temps (étapes +
         anomalies + opérations). Le distinct évite les doublons introduits par
         les JOIN croisés.
    """
    date_filter = _get_date_filter(request)

    programmes = list(
        Programme.objects
        .filter(date_programme=date_filter, is_deleted=False)
        .select_related("utilisateur", "vehicule")
        .annotate(
            total_etapes=Count("etapes", filter=Q(etapes__is_deleted=False), distinct=True),
            etapes_visitees=Count(
                "etapes",
                filter=Q(etapes__is_deleted=False, etapes__statut_visite=StatutVisite.VISITEE),
                distinct=True,
            ),
            etapes_echec=Count(
                "etapes",
                filter=Q(etapes__is_deleted=False, etapes__statut_visite="ECHEC"),
                distinct=True,
            ),
            nb_anomalies=Count("anomalies", filter=Q(anomalies__is_deleted=False), distinct=True),
        )
        .order_by("type_programme", "utilisateur__code_livreur")
    )

    # Agrégats financiers séparés pour éviter l'inflation des sommes
    op_stats = (
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .values("etape__programme_id")
        .annotate(
            nb_ops=Count("id"),
            montant_total=Coalesce(Sum("montant_total"), 0, output_field=DecimalField()),
            montant_encaisse=Coalesce(Sum("montant_encaisse"), 0, output_field=DecimalField()),
        )
    )
    op_by_prog = {row["etape__programme_id"]: row for row in op_stats}

    for prog in programmes:
        stats = op_by_prog.get(prog.id, {})
        prog.nb_operations        = stats.get("nb_ops", 0)
        prog.montant_total_ops    = stats.get("montant_total", 0)
        prog.montant_encaisse_ops = stats.get("montant_encaisse", 0)
        prog.taux = (
            round(prog.etapes_visitees / prog.total_etapes * 100)
            if prog.total_etapes else 0
        )

    # Totaux globaux pour le bas du rapport
    totaux = {
        "total_etapes":     sum(p.total_etapes        for p in programmes),
        "etapes_visitees":  sum(p.etapes_visitees      for p in programmes),
        "etapes_echec":     sum(p.etapes_echec         for p in programmes),
        "nb_operations":    sum(p.nb_operations        for p in programmes),
        "montant_total":    sum(p.montant_total_ops    for p in programmes),
        "montant_encaisse": sum(p.montant_encaisse_ops for p in programmes),
        "nb_anomalies":     sum(p.nb_anomalies         for p in programmes),
    }

    return render(request, "supervision/rapport_journee.html", {
        "programmes":  programmes,
        "totaux":      totaux,
        "date_filter": date_filter,
        "date_prev":   date_filter - timedelta(days=1),
        "date_next":   date_filter + timedelta(days=1),
        "date_today":  date.today(),
    })
