"""
Simulation de la remontée vers Sage X3.

Ce module crée un DocumentX3 mocké pour chaque opération COLLECTE ou
RESTITUTION après un push réussi. Il est appelé en best-effort depuis
sync_api/views.py après traitement du push (non bloquant).

       Règles métier :
         - COLLECTE   -> crée un BCR (Bon de Collecte Recharge)
         - RESTITUTION -> crée un BL  (Bordereau de Livraison) rattaché au BCR
           le plus récent sur le même PLV. Si aucun BCR n'existe, le BL est
           exclu et un avertissement est émis.
         - LIVRAISON_DIRECTE / CONSIGNE -> hors périmètre, ignorés.

La création de documents X3 est une
simulation : son échec ne doit pas faire échouer la synchronisation
principale. Le try/except dans creer_documents_x3 garantit que même
une erreur inattendue ne remonte pas au mobile.

La vue push peut être
rejouée (idempotence du push). Pour chaque opération, on vérifie si
un DocumentX3 existe déjà (filter.exists()) avant de créer. Cela évite
les doublons sans transaction de niveau supérieur.

Règle comptable X3 : un BL prouve qu'un gaz plein
a été livré ; le BCR prouve que l'emballage vide a été collecté en échange.
Le BL est invalide sans BCR préalable sur le même PLV.
"""
import logging
from datetime import date

logger = logging.getLogger(__name__)


def _numero_x3(prefix: str, pk: int) -> str:
    """
    Génère un numéro X3 simulé au format PREFIX-AAAAMMJJ-NNNNNN.
    On ne connaît le pk
         (BIGSERIAL) qu'après le CREATE. On crée d'abord avec un numéro
         temporaire basé sur l'UUID, puis on met à jour avec le numéro
         définitif basé sur le pk. Cela garantit l'unicité sans réserver
         de séquence à l'avance.
    """
    return f"{prefix}-{date.today():%Y%m%d}-{pk:06d}"


def creer_documents_x3(operations: list) -> None:
    """
    Crée un DocumentX3 pour chaque opération éligible de la liste.

    Évite les imports circulaires entre
         mock_x3.x3_sync et mock_x3.models au chargement du module.

    Paramètre `operations` : queryset ou liste d'Operation avec
    select_related('etape__plv') déjà chargé (exigé pour _creer_bl).
    """
    from .models import DocumentX3

    for operation in operations:
        try:
            if DocumentX3.objects.filter(operation=operation).exists():
                continue  # idempotent : le document existe déjà

            if operation.type_operation == "COLLECTE":
                _creer_bcr(operation, DocumentX3)
            elif operation.type_operation == "RESTITUTION":
                _creer_bl(operation, DocumentX3)
            # LIVRAISON_DIRECTE et CONSIGNE sont hors périmètre X3 dans ce POC

        except Exception as exc:
            logger.warning(
                "x3_sync : erreur création DocumentX3 pour opération %s : %s",
                operation.uuid,
                exc,
            )


def _creer_bcr(operation, DocumentX3) -> None:
    """
    Crée un BCR (Bon de Collecte Recharge) pour une opération COLLECTE.
    Voir _numero_x3 : on crée avec TEMP puis on
         met à jour avec le numéro basé sur le pk auto-incrémenté.
    """
    doc = DocumentX3.objects.create(
        numero_x3=f"TEMP-{operation.uuid.hex[:12]}",
        type_document=DocumentX3.TYPE_BCR,
        operation=operation,
        statut="SYNCHRONISE",
    )
    doc.numero_x3 = _numero_x3("BCR", doc.pk)
    doc.save(update_fields=["numero_x3"])
    logger.info("x3_sync : BCR %s créé pour opération %s.", doc.numero_x3, operation.uuid)


def _creer_bl(operation, DocumentX3) -> None:
    """
    Crée un BL (Bordereau de Livraison) pour une opération RESTITUTION,
    rattaché au BCR le plus récent sur le même PLV.

    La règle métier exige qu'une livraison
         de gaz plein soit précédée d'une collecte de vides sur le même point.
         On prend le BCR le plus récent (order_by -created_at) par proximité
         temporelle.
    """
    # Recherche du BCR le plus récent sur le même PLV
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
            "x3_sync : BL non créé pour opération %s : aucun BCR existant sur le PLV '%s'.",
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
        "x3_sync : BL %s créé pour opération %s, rattaché au BCR %s.",
        doc.numero_x3, operation.uuid, bcr.numero_x3,
    )
