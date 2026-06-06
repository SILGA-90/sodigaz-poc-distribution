"""
Simulation de la remontée vers Sage X3.

Appelé en best-effort depuis sync_api après chaque push réussi.
Crée un DocumentX3 mocké par opération :
  - COLLECTE  → BCR (Bon de Collecte Recharge)
  - RESTITUTION → BL (Bordereau de Livraison) rattaché au BCR du même PLV

Un BL sans BCR préalable sur le même PLV est exclu (règle métier) :
l'opération est ignorée et un avertissement est émis dans les logs.
"""
import logging
from datetime import date

logger = logging.getLogger(__name__)


def _numero_x3(prefix: str, pk: int) -> str:
    return f"{prefix}-{date.today():%Y%m%d}-{pk:06d}"


def creer_documents_x3(operations: list) -> None:
    """
    Crée un DocumentX3 pour chaque opération de la liste.

    Idempotent : si le document existe déjà pour une opération, il est ignoré.
    Les opérations de type LIVRAISON_DIRECTE et CONSIGNE sont hors périmètre.

    `operations` doit être une queryset ou une liste d'Operation avec
    select_related('etape__plv') déjà chargé.
    """
    from .models import DocumentX3

    for operation in operations:
        try:
            if DocumentX3.objects.filter(operation=operation).exists():
                continue

            if operation.type_operation == "COLLECTE":
                _creer_bcr(operation, DocumentX3)
            elif operation.type_operation == "RESTITUTION":
                _creer_bl(operation, DocumentX3)

        except Exception as exc:
            logger.warning(
                "x3_sync : erreur creation DocumentX3 pour operation %s : %s",
                operation.uuid,
                exc,
            )


def _creer_bcr(operation, DocumentX3) -> None:
    doc = DocumentX3.objects.create(
        numero_x3=f"TEMP-{operation.uuid.hex[:12]}",
        type_document=DocumentX3.TYPE_BCR,
        operation=operation,
        statut="SYNCHRONISE",
    )
    doc.numero_x3 = _numero_x3("BCR", doc.pk)
    doc.save(update_fields=["numero_x3"])
    logger.info("x3_sync : BCR %s cree pour operation %s.", doc.numero_x3, operation.uuid)


def _creer_bl(operation, DocumentX3) -> None:
    # Recherche du BCR le plus récent sur le même PLV (même client)
    bcr = (
        DocumentX3.objects.filter(
            type_document=DocumentX3.TYPE_BCR,
            operation__etape__plv=operation.etape.plv,
        )
        .order_by("-created_at")
        .first()
    )

    if bcr is None:
        logger.warning(
            "x3_sync : BL non cree pour operation %s — aucun BCR existant sur le PLV '%s'.",
            operation.uuid,
            operation.etape.plv.libelle,
        )
        return

    doc = DocumentX3.objects.create(
        numero_x3=f"TEMP-{operation.uuid.hex[:12]}",
        type_document=DocumentX3.TYPE_BL,
        operation=operation,
        bcr=bcr,
        statut="SYNCHRONISE",
    )
    doc.numero_x3 = _numero_x3("BL", doc.pk)
    doc.save(update_fields=["numero_x3"])
    logger.info(
        "x3_sync : BL %s cree pour operation %s, rattache au BCR %s.",
        doc.numero_x3,
        operation.uuid,
        bcr.numero_x3,
    )
