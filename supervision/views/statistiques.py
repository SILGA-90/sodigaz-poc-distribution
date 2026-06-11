"""
Vue Statistiques & Tendances : agrégats multi-jours.

Ce module génère la page statistiques de la supervision, qui présente
des indicateurs agrégés sur une période choisie (aujourd'hui / 7 jours /
ce mois / 90 jours). Les données alimentent des graphiques Chart.js côté
client (JSON sérialisé dans le contexte Django).

       Séries calculées :
       - Montant encaissé + nb opérations par jour (courbes)
       - Taux de couverture des PLVs par jour (courbe)
       - Anomalies par type (barres) et par gravité (donut)
       - Répartition par article collecte/restitution (barres groupées)
       - Performance par livreur (couverture PLVs, montant)
       - Détail articles par livreur (tableau)

- Aujourd'hui : journée en cours, pour le superviseur en temps réel.
       - 7 jours     : semaine glissante (end_date - 6j = 7 jours inclus).
       - Ce mois     : du 1er du mois courant à aujourd'hui : aligne avec le
                       cycle de facturation mensuel SODIGAZ, plus pertinent
                       qu'une fenêtre glissante de 30 jours.
       - 90 jours    : trimestre glissant pour les tendances longues.

Les graphiques Chart.js sont renderés côté client.
On sérialise les séries en JSON dans le contexte Django et on les injecte
dans un bloc <script> du template. C'est le moyen le plus simple sans
endpoint AJAX supplémentaire pour la page statistiques.

On n'affiche dans le graphique que les types
d'article ayant au moins une quantité sur la période : évite des barres
à zéro parasites si un article n'est pas utilisé sur la période.

Un jour sans programme ne doit pas compter
comme "0 %" dans la moyenne : c'est une absence de donnée, pas un échec.
None est ensuite filtré pour le calcul de taux_moyen.
"""
import json
from datetime import date as date_cls, timedelta
from decimal import Decimal

from django.db.models import Case, Count, DecimalField, IntegerField, Sum, When
from django.db.models.functions import Coalesce
from django.shortcuts import render

from distribution.models import (
    Anomalie, Etape, LigneOperation, Operation, Programme, StatutVisite,
)

from ..decorators import superviseur_required


@superviseur_required
def statistiques(request):
    """
    Vue unique générant toutes les séries statistiques pour le template.

    Chaque bloc (opérations,
         étapes, anomalies, articles, livreurs) fait sa propre requête agrégée
         avec GROUP BY. Fusionner tout en une requête serait illisible et
         provoquerait des inflations de COUNT dues aux JOIN multiples.
    """
    # Calcul de la fenêtre temporelle
    periode = request.GET.get("periode", "7")
    if periode not in ("aujourd_hui", "7", "mois", "90"):
        periode = "7"

    end_date = date_cls.today()
    if periode == "aujourd_hui":
        start_date = end_date
    elif periode == "7":
        start_date = end_date - timedelta(days=6)
    elif periode == "mois":
        # "Ce mois" = du 1er du mois courant à aujourd'hui (cycle de facturation)
        start_date = end_date.replace(day=1)
    else:  # "90"
        start_date = end_date - timedelta(days=89)

    nb_jours = (end_date - start_date).days + 1
    all_days  = [start_date + timedelta(days=i) for i in range(nb_jours)]
    labels    = [d.strftime("%d/%m") for d in all_days]

    # Montant encaissé + nb opérations par jour
    ops_rows = (
        Operation.objects
        .filter(
            etape__programme__date_programme__range=(start_date, end_date),
            is_deleted=False,
        )
        .values("etape__programme__date_programme")
        .annotate(
            montant=Coalesce(Sum("montant_encaisse"), Decimal("0"), output_field=DecimalField()),
            nb_ops=Count("id"),
        )
    )
    ops_by_day = {row["etape__programme__date_programme"]: row for row in ops_rows}

    montants        = [float(ops_by_day.get(d, {}).get("montant", 0)) for d in all_days]
    nb_ops_par_jour = [ops_by_day.get(d, {}).get("nb_ops", 0)         for d in all_days]

    # Taux de couverture des PLVs par jour
    etapes_rows = (
        Etape.objects
        .filter(
            programme__date_programme__range=(start_date, end_date),
            programme__is_deleted=False,
            is_deleted=False,
        )
        .values("programme__date_programme")
        .annotate(
            total=Count("id"),
            visitees=Count(
                Case(When(statut_visite=StatutVisite.VISITEE, then=1), output_field=IntegerField())
            ),
        )
    )
    etapes_by_day = {row["programme__date_programme"]: row for row in etapes_rows}

    # None = pas de programme ce jour-là (exclu de la moyenne : voir module docstring)
    taux_couverture = []
    for d in all_days:
        row   = etapes_by_day.get(d)
        total = row["total"] if row else 0
        taux_couverture.append(
            round(row["visitees"] / total * 100, 1) if (row and total) else None
        )

    # Anomalies par type (barres) et par gravité (donut)
    anom_rows = (
        Anomalie.objects
        .filter(
            programme__date_programme__range=(start_date, end_date),
            programme__is_deleted=False,
            is_deleted=False,
        )
        .values("type_anomalie")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    anom_labels = [row["type_anomalie"] for row in anom_rows]
    anom_counts = [row["count"]         for row in anom_rows]

    gravite_rows = (
        Anomalie.objects
        .filter(
            programme__date_programme__range=(start_date, end_date),
            programme__is_deleted=False,
            is_deleted=False,
        )
        .values("gravite")
        .annotate(count=Count("id"))
    )
    gravite_map  = {r["gravite"]: r["count"] for r in gravite_rows}
    gravite_data = [
        gravite_map.get("FAIBLE",  0),
        gravite_map.get("MOYENNE", 0),
        gravite_map.get("ELEVEE",  0),
    ]

    # Répartition par article (collecte vs restitution)
    # Seuls les articles ayant au moins une quantité sur la période sont affichés.
    ARTICLE_ORDER  = ["B6", "B12_5", "B38", "VRAC"]
    ARTICLE_LABELS = {"B6": "6 kg", "B12_5": "12,5 kg", "B38": "38 kg", "VRAC": "Vrac"}

    article_rows = (
        LigneOperation.objects
        .filter(
            operation__etape__programme__date_programme__range=(start_date, end_date),
            operation__is_deleted=False,
            is_deleted=False,
        )
        .values("produit__type_emballage", "operation__type_operation")
        .annotate(qte=Sum("quantite_realisee"))
    )

    article_map = {}
    for row in article_rows:
        te   = row["produit__type_emballage"]
        tops = row["operation__type_operation"]
        qte  = int(row["qte"] or 0)
        if te not in article_map:
            article_map[te] = {"COLLECTE": 0, "RESTITUTION": 0}
        if tops in ("COLLECTE", "RESTITUTION"):
            article_map[te][tops] = qte

    active_articles       = [p for p in ARTICLE_ORDER if p in article_map]
    article_chart_labels  = [ARTICLE_LABELS[p]              for p in active_articles]
    article_collecte_data = [article_map[p].get("COLLECTE",    0) for p in active_articles]
    article_restit_data   = [article_map[p].get("RESTITUTION", 0) for p in active_articles]
    total_articles        = sum(article_collecte_data) + sum(article_restit_data)

    # Performance par livreur (taux de couverture PLVs + montant)
    livreur_etapes_rows = (
        Etape.objects
        .filter(
            programme__date_programme__range=(start_date, end_date),
            programme__is_deleted=False,
            is_deleted=False,
        )
        .values("programme__utilisateur__code_livreur")
        .annotate(
            total=Count("id"),
            visitees=Count(
                Case(When(statut_visite=StatutVisite.VISITEE, then=1), output_field=IntegerField())
            ),
        )
    )

    livreur_montants_rows = (
        Operation.objects
        .filter(
            etape__programme__date_programme__range=(start_date, end_date),
            is_deleted=False,
        )
        .values("etape__programme__utilisateur__code_livreur")
        .annotate(montant=Coalesce(Sum("montant_encaisse"), Decimal("0"), output_field=DecimalField()))
    )

    perf_map = {}
    for row in livreur_etapes_rows:
        code  = row["programme__utilisateur__code_livreur"]
        total = row["total"]
        perf_map[code] = {
            "taux":     round(row["visitees"] / total * 100, 1) if total else 0,
            "visitees": row["visitees"],
            "total":    total,
            "montant":  0,
        }
    for row in livreur_montants_rows:
        code = row["etape__programme__utilisateur__code_livreur"]
        m    = float(row["montant"] or 0)
        if code in perf_map:
            perf_map[code]["montant"] = m
        else:
            perf_map[code] = {"taux": 0, "visitees": 0, "total": 0, "montant": m}

    # Tri : meilleur taux de couverture en premier
    perf_sorted   = sorted(perf_map.items(), key=lambda x: x[1]["taux"], reverse=True)
    perf_labels   = [code         for code, _ in perf_sorted]
    perf_taux     = [d["taux"]    for _, d   in perf_sorted]
    perf_montants = [d["montant"] for _, d   in perf_sorted]
    perf_visitees = [d["visitees"] for _, d  in perf_sorted]
    perf_totaux   = [d["total"]   for _, d   in perf_sorted]

    # Détail articles par livreur (tableau sous le graphe perf)
    # Seuls B6, B12_5, B38 : VRAC exclu du tableau de détail (volume différent).
    DETAIL_EMBS = ["B6", "B12_5", "B38"]

    livreur_articles_rows = (
        LigneOperation.objects
        .filter(
            operation__etape__programme__date_programme__range=(start_date, end_date),
            operation__is_deleted=False,
            is_deleted=False,
            operation__type_operation__in=("COLLECTE", "RESTITUTION"),
            produit__type_emballage__in=DETAIL_EMBS,
        )
        .values(
            "operation__etape__programme__utilisateur__code_livreur",
            "operation__type_operation",
            "produit__type_emballage",
        )
        .annotate(qte=Sum("quantite_realisee"))
    )

    perf_detail_map = {}
    for row in livreur_articles_rows:
        code = row["operation__etape__programme__utilisateur__code_livreur"]
        tops = row["operation__type_operation"]
        emb  = row["produit__type_emballage"]
        qte  = int(row["qte"] or 0)
        if code not in perf_detail_map:
            perf_detail_map[code] = {"COLLECTE": {}, "RESTITUTION": {}}
        perf_detail_map[code][tops][emb] = qte

    perf_detail_rows = []
    for code, _ in perf_sorted:
        if code not in perf_detail_map:
            continue  # livreur sans ligne_operation sur la période
        detail = perf_detail_map[code]
        r = {"code": code}
        for emb in DETAIL_EMBS:
            r[f"coll_{emb}"] = detail.get("COLLECTE",    {}).get(emb, 0)
            r[f"rest_{emb}"] = detail.get("RESTITUTION", {}).get(emb, 0)
        r["total_coll"] = sum(r[f"coll_{e}"] for e in DETAIL_EMBS)
        r["total_rest"] = sum(r[f"rest_{e}"] for e in DETAIL_EMBS)
        if r["total_coll"] + r["total_rest"] > 0:
            perf_detail_rows.append(r)

    # KPI résumé
    total_montant   = sum(montants)
    total_ops       = sum(nb_ops_par_jour)
    total_anom      = sum(anom_counts)
    moy_journaliere = round(total_montant / nb_jours, 0)

    # Exclure les jours sans programme (None) du calcul de taux moyen
    jours_actifs = [t for t in taux_couverture if t is not None]
    taux_moyen   = round(sum(jours_actifs) / len(jours_actifs), 1) if jours_actifs else 0

    nb_programmes = Programme.objects.filter(
        date_programme__range=(start_date, end_date),
        is_deleted=False,
    ).count()

    return render(request, "supervision/statistiques.html", {
        "periode":    periode,
        "start_date": start_date,
        "end_date":   end_date,
        # Séries Chart.js sérialisées en JSON (injectées dans <script> du template)
        "labels_json":     json.dumps(labels),
        "montants_json":   json.dumps(montants),
        "nb_ops_json":     json.dumps(nb_ops_par_jour),
        "couverture_json": json.dumps(taux_couverture),
        "anom_labels_json":      json.dumps(anom_labels),
        "anom_counts_json":      json.dumps(anom_counts),
        "gravite_json":          json.dumps(gravite_data),
        "article_labels_json":   json.dumps(article_chart_labels),
        "article_collecte_json": json.dumps(article_collecte_data),
        "article_restit_json":   json.dumps(article_restit_data),
        "total_articles":        total_articles,
        "perf_labels_json":   json.dumps(perf_labels),
        "perf_taux_json":     json.dumps(perf_taux),
        "perf_montants_json": json.dumps(perf_montants),
        "perf_visitees_json": json.dumps(perf_visitees),
        "perf_totaux_json":   json.dumps(perf_totaux),
        "nb_livreurs":        len(perf_labels),
        "perf_detail_rows":   perf_detail_rows,
        # KPI
        "total_montant":   total_montant,
        "total_ops":       total_ops,
        "total_anom":      total_anom,
        "moy_journaliere": moy_journaliere,
        "taux_moyen":      taux_moyen,
        "nb_programmes":   nb_programmes,
    })
