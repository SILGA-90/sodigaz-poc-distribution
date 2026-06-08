"""Vues des opérations terrain (liste, détail, export CSV)."""
import csv

from django.http import HttpResponse
from django.shortcuts import get_object_or_404, render

from accounts.models import Role, Utilisateur
from distribution.models import Operation

from ..decorators import superviseur_required
from ._base import _get_date_filter


def _filter_operations(base_qs, livreur_code: str, type_filter: str):
    """Applique les filtres livreur et type sur un queryset d'opérations."""
    if livreur_code:
        base_qs = base_qs.filter(
            etape__programme__utilisateur__code_livreur=livreur_code
        )
    if type_filter in ("COLLECTE", "RESTITUTION"):
        base_qs = base_qs.filter(type_operation=type_filter)
    return base_qs


@superviseur_required
def operations_list(request):
    date_filter = _get_date_filter(request)
    livreur_code = request.GET.get("livreur", "").strip()
    type_filter = request.GET.get("type", "").strip()

    operations = list(_filter_operations(
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .select_related("etape__plv__client", "etape__programme__utilisateur")
        .order_by("-date_heure"),
        livreur_code,
        type_filter,
    ))

    livreurs = Utilisateur.objects.filter(role=Role.LIVREUR, is_active=True).order_by("code_livreur")
    nb_total       = len(operations)
    nb_collecte    = sum(1 for op in operations if op.type_operation == "COLLECTE")
    nb_restitution = sum(1 for op in operations if op.type_operation == "RESTITUTION")
    total_montant  = sum(op.montant_total or 0 for op in operations)

    return render(request, "supervision/operations_list.html", {
        "operations":     operations,
        "date_filter":    date_filter,
        "livreur_code":   livreur_code,
        "type_filter":    type_filter,
        "livreurs":       livreurs,
        "total_montant":  total_montant,
        "nb_total":       nb_total,
        "nb_collecte":    nb_collecte,
        "nb_restitution": nb_restitution,
    })


@superviseur_required
def operation_detail(request, operation_uuid):
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
    """Exporte les opérations filtrées en CSV (séparateur point-virgule)."""
    date_filter = _get_date_filter(request)
    livreur_code = request.GET.get("livreur", "").strip()
    type_filter = request.GET.get("type", "").strip()

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
        "Heure", "Livreur", "Type", "Sous-type",
        "Client", "PLV",
        "Montant total (FCFA)", "Montant encaisse (FCFA)",
        "Mode paiement", "Signataire",
    ])
    for op in operations:
        writer.writerow([
            op.date_heure.strftime("%H:%M"),
            op.etape.programme.utilisateur.code_livreur,
            op.type_operation,
            op.sous_type or "",
            op.etape.plv.client.raison_sociale,
            op.etape.plv.libelle,
            op.montant_total,
            op.montant_encaisse if op.est_encaissee else "",
            op.get_mode_paiement_display() if op.mode_paiement else "",
            op.nom_signataire_client or "",
        ])
    return response
