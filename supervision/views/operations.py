"""
Vues des opérations terrain (liste, détail, export CSV).

Ce module expose trois vues pour consulter les opérations terrain :
  - operations_list()       : liste filtrée par date, livreur et type
  - operation_detail()      : détail d'une opération (lignes, photos, GPS)
  - operations_export_csv() : export CSV des opérations filtrées

La liste donne une vue agrégée (type, montant,
livreur, PLV) pour le superviseur ; le détail expose les données complètes
(lignes par article, signatures, coordonnées GPS) pour une analyse fine.

Le superviseur peut avoir besoin d'exporter les opérations
vers Excel ou un autre outil de reporting. Le CSV est le format le plus
universel et ne nécessite pas de bibliothèque tierce côté serveur.
"""
import csv

from django.http import HttpResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone as tz

from accounts.models import Role, Utilisateur
from distribution.models import Operation

from ..decorators import superviseur_required
from ._base import _get_date_filter


def _filter_operations(base_qs, livreur_code: str, type_filter: str):
    """
    Applique les filtres livreur et type sur un queryset d'opérations.
    Factorisée car utilisée à la fois par la liste
         et l'export CSV : évite la duplication de la logique de filtrage.
    """
    if livreur_code:
        base_qs = base_qs.filter(
            etape__programme__utilisateur__code_livreur=livreur_code
        )
    if type_filter in ("COLLECTE", "RESTITUTION"):
        base_qs = base_qs.filter(type_operation=type_filter)
    return base_qs


@superviseur_required
def operations_list(request):
    """
    Liste les opérations d'un jour donné avec compteurs et filtres.
    La liste affiche le montant
         total de chaque opération (ce qui était dû). Le détail expose le
         montant effectivement encaissé et le mode de paiement.
    """
    date_filter  = _get_date_filter(request)
    livreur_code = request.GET.get("livreur", "").strip()
    type_filter  = request.GET.get("type", "").strip()

    operations = list(_filter_operations(
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .select_related("etape__plv__client", "etape__programme__utilisateur")
        .order_by("-date_heure"),
        livreur_code,
        type_filter,
    ))

    livreurs      = Utilisateur.objects.filter(role=Role.LIVREUR, is_active=True).order_by("code_livreur")
    nb_total      = len(operations)
    nb_collecte   = sum(1 for op in operations if op.type_operation == "COLLECTE")
    nb_restitution = sum(1 for op in operations if op.type_operation == "RESTITUTION")
    total_montant = sum(op.montant_total or 0 for op in operations)

    return render(request, "supervision/operations_list.html", {
        "operations":    operations,
        "date_filter":   date_filter,
        "livreur_code":  livreur_code,
        "type_filter":   type_filter,
        "livreurs":      livreurs,
        "total_montant": total_montant,
        "nb_total":      nb_total,
        "nb_collecte":   nb_collecte,
        "nb_restitution": nb_restitution,
    })


@superviseur_required
def operation_detail(request, operation_uuid):
    """
    Affiche le détail complet d'une opération : lignes par article,
    photos, coordonnées GPS, signatures.

    Le superviseur navigue vers le détail
         depuis la liste ou en saisissant l'UUID (qui figure sur le mobile).
         L'UUID est le seul identifiant partagé entre le mobile et la supervision.
    """
    operation = get_object_or_404(
        Operation.objects
        .select_related(
            "etape__plv__client",
            "etape__programme__utilisateur",
            "etape__programme__vehicule",
        )
        .prefetch_related("lignes__produit", "photos"),
        uuid=operation_uuid,
        is_deleted=False,
    )
    return render(request, "supervision/operation_detail.html", {"operation": operation})


@superviseur_required
def operations_export_csv(request):
    """
    Exporte les opérations filtrées en CSV (séparateur point-virgule,
    encodage UTF-8 BOM pour compatibilité Excel).

    En France et en Afrique francophone, Excel
         utilise le point-virgule comme séparateur CSV par défaut (la virgule
         est réservée aux décimaux dans les paramètres régionaux fr).

    Le BOM UTF-8 (byte order mark) est reconnu par Excel pour
         décoder correctement les caractères accentués sans reconfiguration
         manuelle de l'import.

    Exporter un 0 pour les
         opérations non encaissées (crédit) serait trompeur : mieux vaut laisser
         la cellule vide pour signifier "non applicable".
    """
    date_filter  = _get_date_filter(request)
    livreur_code = request.GET.get("livreur", "").strip()
    type_filter  = request.GET.get("type", "").strip()

    operations = _filter_operations(
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .select_related("etape__plv__client", "etape__programme__utilisateur")
        .order_by("date_heure"),
        livreur_code,
        type_filter,
    )

    filename = f"operations_{date_filter.strftime('%Y-%m-%d')}.csv"
    response = HttpResponse(content_type="text/csv; charset=utf-8-sig")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'

    writer = csv.writer(response, delimiter=";")
    writer.writerow([
        "Date", "Heure", "Programme", "Livreur", "Type", "Sous-type",
        "Client", "PLV",
        "Montant total (FCFA)", "Montant encaissé (FCFA)",
        "Mode paiement", "Signataire",
    ])
    for op in operations:
        # Convertir en heure locale (Africa/Ouagadougou) comme le font les templates,
        # pour que CSV et interface web affichent la même heure.
        dt_local = tz.localtime(op.date_heure)
        writer.writerow([
            dt_local.strftime("%d/%m/%Y"),
            dt_local.strftime("%H:%M"),
            op.etape.programme.numero_x3 or "",
            op.etape.programme.utilisateur.code_livreur,
            op.get_type_operation_display(),
            op.sous_type or "",
            op.etape.plv.client.raison_sociale,
            op.etape.plv.code_plv or op.etape.plv.libelle,
            int(op.montant_total or 0),
            int(op.montant_encaisse or 0) if op.est_encaissee else "",
            op.get_mode_paiement_display() if op.mode_paiement else "",
            op.nom_signataire_client or "",
        ])
    return response
