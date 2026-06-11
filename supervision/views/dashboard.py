"""
Vues du tableau de bord principal.

Ce module fournit la page principale et les endpoints AJAX qui l'alimentent :
  - dashboard()                     : page principale avec KPIs du jour
  - dashboard_stats_data()          : AJAX : 4 KPIs rafraîchis sans rechargement
  - dashboard_activite_data()       : AJAX : courbe d'activité par heure
  - dashboard_bilan_articles_data() : AJAX : bilan articles collecte/restitution
  - dashboard_activite_recente()    : AJAX : 8 dernières opérations

La carte est dans carte.py ; le suivi par livreur est dans livreurs.py.

Le superviseur doit voir l'avancement des livreurs en quasi temps réel.
On utilise un polling JavaScript (setInterval) plutôt que WebSocket : plus
simple à déployer, et 15 secondes est un intervalle suffisant pour la
supervision terrain (les opérations ne se produisent pas à la seconde près).

Chaque endpoint AJAX agrège uniquement les données dont il a besoin.
Séparer stats_data, activite_data et bilan_articles_data permet de
rafraîchir indépendamment chaque composant de la page sans recharger
l'ensemble.
"""
from datetime import date as date_cls

from django.db.models import Case, Count, IntegerField, Sum, When
from django.db.models.functions import ExtractHour
from django.http import JsonResponse
from django.shortcuts import render

from distribution.models import (
    Anomalie, Article, Etape, LigneOperation, LigneProgramme,
    Operation, Programme, StatutAnomalie, StatutVisite,
)

from ..decorators import superviseur_required
from ._base import _get_date_filter


@superviseur_required
def dashboard(request):
    """
    Page principale du tableau de bord : KPIs du jour, anomalies élevées,
    et données initiales pour les composants AJAX.
    La date sélectionnée est
         mémorisée en session pour rester cohérente entre les navigations.
         write_session=True indique que c'est cette vue qui initialise la session
         (les vues AJAX lisent la date en session sans l'écrire).
    """
    date_filter = _get_date_filter(request, write_session=True)

    programmes_aujourdhui = Programme.objects.filter(
        date_programme=date_filter, is_deleted=False,
    ).select_related("utilisateur", "vehicule")

    nb_programmes          = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=date_filter,
        is_deleted=False,
    )
    nb_operations    = operations_aujourdhui.count()
    montant_encaisse = (
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    # Taux de couverture : étapes visitées / total étapes du jour
    etapes_stats = Etape.objects.filter(
        programme__date_programme=date_filter,
        programme__is_deleted=False,
        is_deleted=False,
    ).aggregate(
        total=Count("id"),
        visitees=Count(Case(When(statut_visite=StatutVisite.VISITEE, then=1), output_field=IntegerField())),
    )
    nb_etapes_total    = etapes_stats["total"] or 0
    nb_etapes_visitees = etapes_stats["visitees"] or 0
    taux_couverture    = round(nb_etapes_visitees / nb_etapes_total * 100) if nb_etapes_total else 0

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=date_filter,
        programme__is_deleted=False,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    # Anomalies ELEVEE affichées dans le bloc d'alertes du dashboard
    anomalies_elevees = (
        Anomalie.objects
        .filter(
            programme__date_programme=date_filter,
            programme__is_deleted=False,
            gravite="ELEVEE",
            statut__in=("OUVERTE", "EN_TRAITEMENT"),
            is_deleted=False,
        )
        .select_related("programme__utilisateur", "plv")
        .order_by("-date_heure")
    )

    return render(request, "supervision/dashboard.html", {
        "today":                   date_filter,
        "date_filter":             date_filter,
        "is_today":                date_filter == date_cls.today(),
        "nb_programmes":           nb_programmes,
        "nb_programmes_en_cours":  nb_programmes_en_cours,
        "nb_programmes_clotures":  nb_programmes_clotures,
        "nb_operations":           nb_operations,
        "montant_encaisse":        montant_encaisse,
        "nb_etapes_total":         nb_etapes_total,
        "nb_etapes_visitees":      nb_etapes_visitees,
        "taux_couverture":         taux_couverture,
        "nb_anomalies_ouvertes":   nb_anomalies_ouvertes,
        "anomalies_elevees":       anomalies_elevees,
    })


@superviseur_required
def dashboard_stats_data(request):
    """
    AJAX : retourne les 4 KPIs principaux pour rafraîchissement sans rechargement.
    Le polling JavaScript du dashboard appelle cet endpoint toutes les 15 s
    pour mettre à jour les compteurs sans recharger la page entière.
    """
    date_filter = _get_date_filter(request)

    programmes_aujourdhui  = Programme.objects.filter(
        date_programme=date_filter, is_deleted=False,
    )
    nb_programmes          = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=date_filter,
        is_deleted=False,
    )
    nb_operations    = operations_aujourdhui.count()
    montant_encaisse = float(
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=date_filter,
        programme__is_deleted=False,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    nb_anomalies_elevees = Anomalie.objects.filter(
        programme__date_programme=date_filter,
        programme__is_deleted=False,
        gravite="ELEVEE",
        statut__in=("OUVERTE", "EN_TRAITEMENT"),
        is_deleted=False,
    ).count()

    etapes_stats = Etape.objects.filter(
        programme__date_programme=date_filter,
        programme__is_deleted=False,
        is_deleted=False,
    ).aggregate(
        total=Count("id"),
        visitees=Count(Case(When(statut_visite=StatutVisite.VISITEE, then=1), output_field=IntegerField())),
    )
    nb_etapes_total    = etapes_stats["total"] or 0
    nb_etapes_visitees = etapes_stats["visitees"] or 0
    taux_couverture    = round(nb_etapes_visitees / nb_etapes_total * 100) if nb_etapes_total else 0

    return JsonResponse({
        "nb_programmes":           nb_programmes,
        "nb_programmes_en_cours":  nb_programmes_en_cours,
        "nb_programmes_clotures":  nb_programmes_clotures,
        "nb_operations":           nb_operations,
        "montant_encaisse":        montant_encaisse,
        "nb_anomalies_ouvertes":   nb_anomalies_ouvertes,
        "nb_anomalies_elevees":    nb_anomalies_elevees,
        "taux_couverture":         taux_couverture,
        "nb_etapes_visitees":      nb_etapes_visitees,
        "nb_etapes_total":         nb_etapes_total,
    })


@superviseur_required
def dashboard_activite_data(request):
    """
    AJAX : nombre d'opérations par heure de la journée (6h-20h).
    Permet de construire le graphique d'activité journalière
         (courbe) côté Chart.js sans pré-calcul côté Python : un seul GROUP BY
         sur la base.
    """
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
    heures    = list(range(6, 21))
    return JsonResponse({
        "labels": [f"{h:02d}h" for h in heures],
        "data":   [par_heure.get(h, 0) for h in heures],
    })


@superviseur_required
def dashboard_bilan_articles_data(request):
    """
    AJAX : bilan articles du jour séparé par flux (collecte / restitution).
    Collecte : quantités réalisées par article.
    Restitution : prévu / réalisé / écart / montant par article.

    La collecte et la restitution ont des sémantiques
         différentes. En collecte, on ne compare pas au prévu (objectif = récupérer
         le maximum de vides). En restitution, le rapprochement prévu/réalisé est
         l'indicateur clé de performance.
    """
    date_filter = _get_date_filter(request)
    base_lo = dict(
        operation__etape__programme__date_programme=date_filter,
        operation__etape__programme__is_deleted=False,
        is_deleted=False,
    )

    collecte_map = {
        row["produit_id"]: row["qte"]
        for row in LigneOperation.objects
        .filter(**base_lo, operation__type_operation="COLLECTE")
        .values("produit_id")
        .annotate(qte=Sum("quantite_realisee"))
    }

    restit_realise_map = {
        row["produit_id"]: row["qte"]
        for row in LigneOperation.objects
        .filter(**base_lo, operation__type_operation="RESTITUTION")
        .values("produit_id")
        .annotate(qte=Sum("quantite_realisee"))
    }

    prevus_map = {
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

    tous_ids = set(collecte_map) | set(restit_realise_map) | set(prevus_map)
    if not tous_ids:
        return JsonResponse({"collecte": [], "restitution": []})

    articles_map = {
        a.id: a
        for a in Article.objects.filter(id__in=tous_ids).only("id", "code_x3", "libelle", "prix_unitaire")
    }

    collecte_result = [
        {
            "code_x3": articles_map[pid].code_x3,
            "libelle": articles_map[pid].libelle,
            "realise": collecte_map[pid],
        }
        for pid in sorted(collecte_map, key=lambda i: articles_map[i].code_x3)
    ]

    restit_ids    = set(restit_realise_map) | set(prevus_map)
    restit_result = []
    for pid in sorted(restit_ids, key=lambda i: articles_map[i].code_x3):
        art     = articles_map[pid]
        prevu   = prevus_map.get(pid, 0)
        realise = restit_realise_map.get(pid, 0)
        restit_result.append({
            "code_x3": art.code_x3,
            "libelle": art.libelle,
            "prevu":   prevu,
            "realise": realise,
            "ecart":   realise - prevu,
            "montant": realise * int(art.prix_unitaire or 0),
        })

    return JsonResponse({"collecte": collecte_result, "restitution": restit_result})


@superviseur_required
def dashboard_activite_recente(request):
    """
    AJAX : retourne les 8 dernières opérations de la journée.
    Limite arbitraire raisonnable pour le fil d'activité
         affiché dans un bloc compact du dashboard : assez pour voir l'activité
         récente, pas trop pour ne pas noyer.
    """
    date_filter = _get_date_filter(request)
    ops = (
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .select_related("etape__plv", "etape__programme__utilisateur")
        .order_by("-date_heure")[:8]
    )
    result = []
    for op in ops:
        result.append({
            "uuid":     str(op.uuid),
            "heure":    op.date_heure.strftime("%H:%M"),
            "livreur":  op.etape.programme.utilisateur.code_livreur,
            "code_plv": op.etape.plv.code_plv or "",
            "plv":      op.etape.plv.libelle,
            "type":     op.type_operation,
            "montant":  float(op.montant_encaisse or 0),
        })
    return JsonResponse({"operations": result})
