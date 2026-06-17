"""
Vue de suivi temps réel par livreur.

  - tableau_bord_livreurs() : page avec une fiche par livreur (étapes,
    opérations, anomalies, dernière activité)

On charge tous les programmes du jour d'abord, puis on fait 4 requêtes
agrégées (étapes, opérations, anomalies, dernière activité) avec des GROUP BY
sur programme_id. C'est 5 requêtes au total (1 programmes + 4 agrégats),
quel que soit le nombre de livreurs : pas N+4 comme avec des accès ORM naïfs.
"""
from collections import defaultdict
from datetime import date as date_cls
from decimal import Decimal

from django.db.models import Case, Count, DecimalField, IntegerField, Max, Sum, When
from django.db.models.functions import Coalesce
from django.shortcuts import render

from accounts.models import Utilisateur
from distribution.models import (
    Anomalie, Etape, Operation, Programme, StatutAnomalie, StatutVisite,
)

from ..decorators import superviseur_required
from ._base import _get_date_filter

# Palette d'avatars cyclée par position dans la liste (stable pour un même jeu de livreurs).
# WHY : Évite d'avoir tous les avatars de la même couleur sans dépendre d'une
#       logique aléatoire (qui changerait à chaque rechargement).
_AVATAR_PALETTE = ["#079BD9", "#EE7202", "#6f42c1", "#198754", "#dc3545", "#0dcaf0"]


@superviseur_required
def tableau_bord_livreurs(request):
    """
    Page de suivi temps réel par livreur : une fiche par livreur avec
    ses étapes, opérations, anomalies et dernière activité.

    On charge tous les programmes
         du jour d'abord, puis on fait 4 requêtes agrégées (étapes, opérations,
         anomalies, dernière activité) avec des GROUP BY sur programme_id.
         C'est 5 requêtes au total (1 programmes + 4 agrégats), quel que soit
         le nombre de livreurs : pas N+4 comme avec des accès ORM naïfs.
    """
    date_filter = _get_date_filter(request, write_session=True)

    # Seuls les livreurs ayant un programme ce jour sont affichés.
    # Un livreur peut avoir plusieurs programmes le même jour (collecte + restitution) :
    # on regroupe donc en liste, pas en dict à valeur unique (qui écraserait le second).
    programmes_par_livreur: dict[int, list] = defaultdict(list)
    for p in Programme.objects.filter(
        date_programme=date_filter,
        is_deleted=False,
    ).select_related("utilisateur", "vehicule").order_by("id"):
        programmes_par_livreur[p.utilisateur_id].append(p)

    livreurs      = list(
        Utilisateur.objects.filter(
            id__in=programmes_par_livreur.keys(),
        ).order_by("code_livreur")
    )
    programme_ids = [p.id for progs in programmes_par_livreur.values() for p in progs]

    # Étapes (total / visitées / échecs) par programme : une seule requête SQL
    etapes_qs = (
        Etape.objects.filter(programme_id__in=programme_ids, is_deleted=False)
        .values("programme_id")
        .annotate(
            total=Count("id"),
            visitees=Count(Case(When(statut_visite=StatutVisite.VISITEE, then=1), output_field=IntegerField())),
            echecs=Count(Case(When(statut_visite=StatutVisite.ECHEC, then=1), output_field=IntegerField())),
        )
    )
    etapes_map = {row["programme_id"]: row for row in etapes_qs}

    # Opérations (count + montant encaissé) par programme : une seule requête SQL
    ops_qs = (
        Operation.objects.filter(etape__programme_id__in=programme_ids, is_deleted=False)
        .values("etape__programme_id")
        .annotate(nb_ops=Count("id"), montant=Coalesce(Sum("montant_encaisse"), Decimal("0"), output_field=DecimalField()))
    )
    ops_map = {row["etape__programme_id"]: row for row in ops_qs}

    # Anomalies (ouvertes + total) par programme : une seule requête SQL
    anom_qs = (
        Anomalie.objects.filter(programme_id__in=programme_ids, is_deleted=False)
        .values("programme_id")
        .annotate(
            ouvertes=Count(Case(When(statut=StatutAnomalie.OUVERTE, then=1), output_field=IntegerField())),
            total_anom=Count("id"),
        )
    )
    anom_map = {row["programme_id"]: row for row in anom_qs}

    # Dernière activité (max date_heure d'opération) par programme : une seule requête SQL
    last_op_map = {
        row["etape__programme_id"]: row["derniere"]
        for row in Operation.objects.filter(
            etape__programme_id__in=programme_ids, is_deleted=False,
        )
        .values("etape__programme_id")
        .annotate(derniere=Max("date_heure"))
    }

    # Construction des fiches livreur.
    # On somme les stats de TOUS les programmes du livreur pour la journée.
    fiches = []
    for idx, liv in enumerate(livreurs):
        progs    = programmes_par_livreur.get(liv.id, [])
        av_color = _AVATAR_PALETTE[idx % len(_AVATAR_PALETTE)]

        etapes            = {"total": 0, "visitees": 0, "echecs": 0}
        ops               = {"nb_ops": 0, "montant": Decimal("0")}
        anom              = {"ouvertes": 0, "total_anom": 0}
        derniere_activite = None

        for p in progs:
            e = etapes_map.get(p.id, {"total": 0, "visitees": 0, "echecs": 0})
            etapes["total"]    += e["total"]
            etapes["visitees"] += e["visitees"]
            etapes["echecs"]   += e["echecs"]

            o = ops_map.get(p.id, {"nb_ops": 0, "montant": Decimal("0")})
            ops["nb_ops"]  += o["nb_ops"]
            ops["montant"] += o["montant"]

            a = anom_map.get(p.id, {"ouvertes": 0, "total_anom": 0})
            anom["ouvertes"]    += a["ouvertes"]
            anom["total_anom"]  += a["total_anom"]

            d = last_op_map.get(p.id)
            if d and (derniere_activite is None or d > derniere_activite):
                derniere_activite = d

        pct  = round(etapes["visitees"] / etapes["total"] * 100) if etapes["total"] else 0
        prog = progs[0] if progs else None  # programme représentatif pour l'affichage

        fiches.append({
            "livreur":           liv,
            "programme":         prog,
            "programmes":        progs,
            "av_color":          av_color,
            "etapes":            etapes,
            "ops":               ops,
            "anom":              anom,
            "derniere_activite": derniere_activite,
            "pct":               pct,
        })

    return render(request, "supervision/livreurs.html", {
        "date_filter": date_filter,
        "is_today":    date_filter == date_cls.today(),
        "fiches":      fiches,
    })
