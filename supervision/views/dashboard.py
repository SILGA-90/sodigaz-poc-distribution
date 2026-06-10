"""Vues du tableau de bord (carte, KPI, activité, fiches livreurs)."""
from datetime import date as date_cls

from decimal import Decimal

from django.db.models import Case, Count, DecimalField, Exists, IntegerField, Max, OuterRef, Sum, When
from django.db.models.functions import Coalesce, ExtractHour
from django.http import JsonResponse
from django.shortcuts import render

from accounts.models import Role, Utilisateur
from distribution.models import (
    Anomalie, Etape, LigneOperation, LigneProgramme,
    Operation, Plv, Produit, Programme, StatutAnomalie, StatutVisite,
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
        "today": date_filter,
        "date_filter": date_filter,
        "is_today": date_filter == date_cls.today(),
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_etapes_total": nb_etapes_total,
        "nb_etapes_visitees": nb_etapes_visitees,
        "taux_couverture": taux_couverture,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
        "anomalies_elevees": anomalies_elevees,
    })


@superviseur_required
def dashboard_carte_data(request):
    """AJAX : PLV actives + opérations géolocalisées du jour (pour Leaflet).
    Paramètre GET optionnel : livreur (code_livreur) — filtre les opérations.
    """
    date_filter  = _get_date_filter(request)
    livreur_code = request.GET.get("livreur", "").strip()

    # Quand un livreur est sélectionné : n'afficher que ses PLVs assignées,
    # et marquer "visitée" uniquement selon ses propres opérations.
    if livreur_code:
        # related_name="etapes" sur Etape.plv → traversée inverse via "etapes__"
        plvs_qs = (
            Plv.objects.filter(
                statut="ACTIF",
                etapes__programme__utilisateur__code_livreur=livreur_code,
                etapes__programme__date_programme=date_filter,
                etapes__programme__is_deleted=False,
                etapes__is_deleted=False,
            ).distinct()
        )
        visite_filter = dict(
            etape__programme__utilisateur__code_livreur=livreur_code,
        )
    else:
        plvs_qs = Plv.objects.filter(statut="ACTIF")
        visite_filter = {}

    plvs = []
    for plv in (
        plvs_qs
        .select_related("client")
        .annotate(
            visite=Exists(
                Operation.objects.filter(
                    etape__plv=OuterRef("pk"),
                    etape__programme__date_programme=date_filter,
                    is_deleted=False,
                    **visite_filter,
                )
            )
        )
    ):
        plvs.append({
            "id": plv.id,
            "code_plv": plv.code_plv or "",
            "libelle": plv.libelle,
            "client": plv.client.raison_sociale,
            "latitude": plv.localisation.y,
            "longitude": plv.localisation.x,
            "visite": plv.visite,
        })

    ops_qs = (
        Operation.objects
        .filter(
            etape__programme__date_programme=date_filter,
            is_deleted=False,
            localisation_saisie__isnull=False,
        )
        .select_related("etape__plv", "etape__programme__utilisateur")
        .order_by("date_heure")
    )
    if livreur_code:
        ops_qs = ops_qs.filter(
            etape__programme__utilisateur__code_livreur=livreur_code
        )

    operations = []
    for op in ops_qs:
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
def carte_plein_ecran(request):
    """Page cartographie plein écran avec filtre livreur."""
    date_filter  = _get_date_filter(request, write_session=True)
    livreur_code = request.GET.get("livreur", "").strip()
    livreurs     = Utilisateur.objects.filter(
        role=Role.LIVREUR, is_active=True,
    ).order_by("code_livreur")
    return render(request, "supervision/carte.html", {
        "date_filter":  date_filter,
        "livreur_code": livreur_code,
        "livreurs":     livreurs,
    })


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
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
        "nb_anomalies_elevees": nb_anomalies_elevees,
        "taux_couverture": taux_couverture,
        "nb_etapes_visitees": nb_etapes_visitees,
        "nb_etapes_total": nb_etapes_total,
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
    AJAX : bilan produits du jour séparé par flux.
    - collecte   : quantités réalisées par produit sur opérations COLLECTE
    - restitution: prévu / réalisé / écart par produit sur opérations RESTITUTION
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

    produits_map = {
        p.id: p
        for p in Produit.objects.filter(id__in=tous_ids).only("id", "code_x3", "libelle", "prix_unitaire")
    }

    collecte_result = [
        {
            "code_x3": produits_map[pid].code_x3,
            "libelle": produits_map[pid].libelle,
            "realise": collecte_map[pid],
        }
        for pid in sorted(collecte_map, key=lambda i: produits_map[i].code_x3)
    ]

    restit_ids = set(restit_realise_map) | set(prevus_map)
    restit_result = []
    for pid in sorted(restit_ids, key=lambda i: produits_map[i].code_x3):
        prod = produits_map[pid]
        prevu = prevus_map.get(pid, 0)
        realise = restit_realise_map.get(pid, 0)
        restit_result.append({
            "code_x3": prod.code_x3,
            "libelle": prod.libelle,
            "prevu": prevu,
            "realise": realise,
            "ecart": realise - prevu,
            "montant": realise * int(prod.prix_unitaire or 0),
        })

    return JsonResponse({"collecte": collecte_result, "restitution": restit_result})


@superviseur_required
def dashboard_activite_recente(request):
    """AJAX : 8 dernières opérations de la journée (fil temps réel)."""
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


# ─────────────────────────────────────────────────────────────────────────────
# Tableau de bord livreurs
# ─────────────────────────────────────────────────────────────────────────────

# Couleurs d'avatar cyclées par position dans la liste (stable pour un même jeu de livreurs)
_AVATAR_PALETTE = ["#079BD9", "#EE7202", "#6f42c1", "#198754", "#dc3545", "#0dcaf0"]


@superviseur_required
def tableau_bord_livreurs(request):
    """Fiche de suivi temps réel par livreur pour la journée."""
    date_filter = _get_date_filter(request, write_session=True)

    # Seuls les livreurs ayant un programme ce jour sont affichés.
    programmes = {
        p.utilisateur_id: p
        for p in Programme.objects.filter(
            date_programme=date_filter,
            is_deleted=False,
        ).select_related("utilisateur", "vehicule")
    }

    livreurs = list(
        Utilisateur.objects.filter(
            id__in=programmes.keys(),
        ).order_by("code_livreur")
    )

    programme_ids = [p.id for p in programmes.values()]

    # Étapes (total / visitées / échecs) par programme — une seule requête
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

    # Opérations (count + montant) par programme — une seule requête
    ops_qs = (
        Operation.objects.filter(etape__programme_id__in=programme_ids, is_deleted=False)
        .values("etape__programme_id")
        .annotate(nb_ops=Count("id"), montant=Coalesce(Sum("montant_encaisse"), Decimal("0"), output_field=DecimalField()))
    )
    ops_map = {row["etape__programme_id"]: row for row in ops_qs}

    # Anomalies (ouvertes + total) par programme — une seule requête
    anom_qs = (
        Anomalie.objects.filter(programme_id__in=programme_ids, is_deleted=False)
        .values("programme_id")
        .annotate(
            ouvertes=Count(Case(When(statut=StatutAnomalie.OUVERTE, then=1), output_field=IntegerField())),
            total_anom=Count("id"),
        )
    )
    anom_map = {row["programme_id"]: row for row in anom_qs}

    # Dernière activité (max date_heure d'opération) par programme — une seule requête
    last_op_map = {
        row["etape__programme_id"]: row["derniere"]
        for row in Operation.objects.filter(
            etape__programme_id__in=programme_ids, is_deleted=False,
        )
        .values("etape__programme_id")
        .annotate(derniere=Max("date_heure"))
    }

    # Construction des fiches
    fiches = []
    for idx, liv in enumerate(livreurs):
        prog = programmes.get(liv.id)
        av_color = _AVATAR_PALETTE[idx % len(_AVATAR_PALETTE)]

        if prog:
            etapes = etapes_map.get(prog.id, {"total": 0, "visitees": 0, "echecs": 0})
            ops = ops_map.get(prog.id, {"nb_ops": 0, "montant": 0})
            anom = anom_map.get(prog.id, {"ouvertes": 0, "total_anom": 0})
            derniere_activite = last_op_map.get(prog.id)
            pct = round(etapes["visitees"] / etapes["total"] * 100) if etapes["total"] else 0
        else:
            etapes = {"total": 0, "visitees": 0, "echecs": 0}
            ops = {"nb_ops": 0, "montant": 0}
            anom = {"ouvertes": 0, "total_anom": 0}
            derniere_activite = None
            pct = 0

        fiches.append({
            "livreur": liv,
            "programme": prog,
            "av_color": av_color,
            "etapes": etapes,
            "ops": ops,
            "anom": anom,
            "derniere_activite": derniere_activite,
            "pct": pct,
        })

    return render(request, "supervision/livreurs.html", {
        "date_filter": date_filter,
        "is_today": date_filter == date_cls.today(),
        "fiches": fiches,
    })
