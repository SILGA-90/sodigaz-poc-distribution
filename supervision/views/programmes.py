"""Vues des programmes de livraison."""
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, render

from distribution.models import Etape, LigneOperation, Operation, Programme, StatutVisite

from ..decorators import superviseur_required
from ._base import _get_date_filter


@superviseur_required
def programmes_list(request):
    date_filter = _get_date_filter(request)

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

    filtre_statut = request.GET.get("filtre_statut", "")
    etapes_qs = programme.etapes.filter(is_deleted=False)
    if filtre_statut in ("A_VISITER", "VISITEE", "ECHEC"):
        etapes_qs = etapes_qs.filter(statut_visite=filtre_statut)

    etapes = (
        etapes_qs
        .select_related("plv", "plv__client")
        .prefetch_related(
            "operations__lignes__produit",
            "operations__document_x3__bcr",
            "lignes_prevues__produit",
        )
        .order_by("ordre_prevu")
    )

    # Réconciliation prévu / réalisé par étape et par produit
    reconciliation = []
    for etape in etapes:
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

    # Timeline chronologique avec détection des écarts d'ordre
    timeline = []
    prev_ordre = 0
    for op in (
        Operation.objects
        .filter(etape__programme=programme, is_deleted=False)
        .select_related("etape__plv")
        .order_by("date_heure")
    ):
        timeline.append({
            "op": op,
            "en_avance": op.etape.ordre_prevu < prev_ordre,
            "conforme": op.etape.ordre_prevu >= prev_ordre,
        })
        prev_ordre = op.etape.ordre_prevu

    return render(request, "supervision/programme_detail.html", {
        "programme": programme,
        "reconciliation": reconciliation,
        "filtre_statut": filtre_statut,
        "timeline": timeline,
    })
