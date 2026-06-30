"""
Vues cartographiques de la supervision.

  - dashboard_carte_data() : AJAX — PLVs + opérations géolocalisées pour Leaflet
  - carte_plein_ecran()    : page cartographie plein écran avec filtre livreur

Quand un livreur est sélectionné, on ne montre que ses PLVs assignés et ses
opérations, pas ceux des autres. Cela permet au superviseur de suivre un livreur
spécifique sur la carte.

Annoter chaque PLV avec un booléen `visite` via Exists() fait un seul LEFT JOIN
côté SQL, évitant N+1 requêtes.
"""
from django.db.models import Exists, OuterRef
from django.http import JsonResponse
from django.shortcuts import render

from accounts.models import Role, Utilisateur
from distribution.models import Operation, Plv

from ..decorators import superviseur_required
from ._base import _get_date_filter


@superviseur_required
def dashboard_carte_data(request):
    """
    Endpoint AJAX : retourne les PLVs actifs et les opérations géolocalisées
    du jour pour alimenter la carte Leaflet.

    Quand un livreur est sélectionné, on ne
         montre que ses PLVs assignés et ses opérations, pas ceux des autres.
         Cela permet au superviseur de suivre un livreur spécifique sur la carte.

    Annoter chaque PLV avec un booléen `visite`
         (opération existante ce jour) via Exists() fait un seul LEFT JOIN
         côté SQL, évitant N+1 requêtes.
    """
    date_filter  = _get_date_filter(request)
    livreur_code = request.GET.get("livreur", "").strip()

    # Quand un livreur est sélectionné : n'afficher que ses PLVs assignés
    if livreur_code:
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
        plvs_qs = (
            Plv.objects.filter(
                statut="ACTIF",
                etapes__programme__date_programme=date_filter,
                etapes__programme__is_deleted=False,
                etapes__is_deleted=False,
            ).distinct()
        )
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
            "id":        plv.id,
            "code_plv":  plv.code_plv or "",
            "libelle":   plv.libelle,
            "client":    plv.client.raison_sociale,
            "latitude":  plv.localisation.y,
            "longitude": plv.localisation.x,
            "visite":    plv.visite,
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
            "uuid":        str(op.uuid),
            "plv":         op.etape.plv.libelle,
            "livreur":     op.etape.programme.utilisateur.code_livreur,
            "type":        op.type_operation,
            "latitude":    op.localisation_saisie.y,
            "longitude":   op.localisation_saisie.x,
            "timestamp":   op.date_heure.isoformat(),
            "ordre_prevu": op.etape.ordre_prevu,
        })

    return JsonResponse({"plvs": plvs, "operations": operations})


@superviseur_required
def carte_plein_ecran(request):
    """
    Page cartographie plein écran avec filtre livreur.
    Offre une vue dédiée à la carte sans les KPIs du dashboard : utile
    pour une projection sur grand écran en salle de supervision.
    """
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
