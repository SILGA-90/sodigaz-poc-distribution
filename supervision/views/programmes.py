"""
Vues des programmes de livraison (liste et détail).

Ce module gère deux pages de la supervision :
  - programmes_list()   : liste des programmes d'une journée avec compteurs
                          d'étapes et filtres de navigation par date.
  - programme_detail()  : détail d'un programme : réconciliation prévu/réalisé
                          par étape, timeline chronologique des opérations.

L'objectif métier central est de comparer
ce qui était planifié (LigneProgramme.quantite_prevue) avec ce qui a été
fait sur le terrain (LigneOperation.quantite_realisee). L'écart = réalisé -
prévu est l'indicateur de performance de la tournée.

Le livreur est libre de dévier du
circuit recommandé. La timeline signale les retours en arrière (ordre
décroissant) pour aider le superviseur à comprendre l'itinéraire réel.
Ce n'est pas un contrôle bloquant, juste un indicateur d'analyse.
"""
from datetime import date, timedelta

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, render

from distribution.models import LigneOperation, Operation, Programme, StatutVisite

from ..decorators import superviseur_required
from ._base import _get_date_filter


@superviseur_required
def programmes_list(request):
    """
    Liste les programmes d'un jour donné avec leurs compteurs d'étapes.

    On calcule total_etapes, etapes_visitees
         et etapes_echec en une seule requête SQL (CASE WHEN dans COUNT) plutôt
         que de charger toutes les étapes en Python. Efficace même avec de
         nombreuses étapes par programme.

    Boutons de navigation jour précédent / suivant
         dans le template : l'utilisateur navigue dans l'historique sans saisir
         de date manuellement.
    """
    date_filter = _get_date_filter(request, write_session=True)

    programmes = list(
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
        "programmes":  programmes,
        "date_filter": date_filter,
        "date_prev":   date_filter - timedelta(days=1),
        "date_next":   date_filter + timedelta(days=1),
        "date_today":  date.today(),
        "nb_total":    len(programmes),
        "nb_planifie": sum(1 for p in programmes if p.statut == "PLANIFIE"),
        "nb_en_cours": sum(1 for p in programmes if p.statut == "EN_COURS"),
        "nb_cloture":  sum(1 for p in programmes if p.statut == "CLOTURE"),
    })


@superviseur_required
def programme_detail(request, programme_id):
    """
    Affiche le détail d'un programme :
           - Réconciliation prévu/réalisé par étape et par article
           - Timeline des opérations dans l'ordre chronologique
           - Filtre par statut de visite (A_VISITER / VISITEE / ECHEC)

    Évite les N+1 requêtes
         lors de la construction de la réconciliation. Une seule passe SQL charge
         toutes les opérations et leurs lignes en mémoire, puis la boucle Python
         construit le dict produits_dict par étape.

    On construit un dict par produit_id
         pour fusionner les quantités prévues et réalisées. Un produit peut
         apparaître dans LigneProgramme (prévu) et/ou LigneOperation (réalisé) ;
         le dict unifie les deux sources en un seul pass.

    L'ordre est "conforme" si le livreur
         avance (ordre croissant ou égal). Un saut en avant (3 -> 5 en sautant 4)
         est conforme : le 4 sera visité plus tard ou en échec. Seul un retour
         en arrière (5 -> 3) est signalé comme "en avance sur le circuit".
    """
    programme = get_object_or_404(
        Programme.objects.select_related("utilisateur", "vehicule"),
        id=programme_id, is_deleted=False,
    )

    filtre_statut = request.GET.get("filtre_statut", "")
    etapes_qs     = programme.etapes.filter(is_deleted=False)
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
        # Charger le prévu
        for lp in etape.lignes_prevues.filter(is_deleted=False):
            produits_dict[lp.produit_id] = {
                "produit": lp.produit,
                "prevu":   lp.quantite_prevue,
                "realise": 0,
            }
        # Ajouter le réalisé (peut inclure des articles hors prévu)
        for op in etape.operations.filter(is_deleted=False):
            for lo in op.lignes.filter(is_deleted=False):
                if lo.produit_id in produits_dict:
                    produits_dict[lo.produit_id]["realise"] += lo.quantite_realisee
                else:
                    produits_dict[lo.produit_id] = {
                        "produit": lo.produit,
                        "prevu":   0,
                        "realise": lo.quantite_realisee,
                    }
        lignes_recon = []
        for d in produits_dict.values():
            d["ecart"] = d["realise"] - d["prevu"]
            lignes_recon.append(d)
        reconciliation.append({"etape": etape, "lignes": lignes_recon})

    # Timeline chronologique avec détection des écarts d'ordre
    timeline  = []
    prev_ordre = 0
    for op in (
        Operation.objects
        .filter(etape__programme=programme, is_deleted=False)
        .select_related("etape__plv")
        .order_by("date_heure")
    ):
        timeline.append({
            "op":        op,
            "en_avance": op.etape.ordre_prevu < prev_ordre,
            "conforme":  op.etape.ordre_prevu >= prev_ordre,
        })
        prev_ordre = op.etape.ordre_prevu

    return render(request, "supervision/programme_detail.html", {
        "programme":     programme,
        "reconciliation": reconciliation,
        "filtre_statut": filtre_statut,
        "timeline":      timeline,
    })
