"""
Modèle de simulation Sage X3.

Ce module définit DocumentX3, qui représente un document commercial
créé dans Sage X3 en réponse à une opération remontée par le mobile.
Dans le mock, la génération est locale et immédiate (x3_sync.py).

       Types de documents :
         - BCR (Bon de Commande Recharge) : créé pour chaque COLLECTE.
         - BL  (Bordereau de Livraison)   : créé pour chaque RESTITUTION,
           obligatoirement rattaché au BCR existant sur le même PLV.

Le flux de remontée vers Sage X3
(création BCR/BL réels) n'est pas implémenté dans ce POC. mock_x3
simule ce flux côté Django pour valider la cohérence des données
et démontrer la faisabilité. C'est une perspective d'évolution :
ne pas prétendre que la création X3 réelle est faite.

Une restitution (livraison de gaz plein) ne peut
exister sans une collecte préalable de bouteilles vides sur le même PLV.
Le BCR est la preuve que l'emballage a été collecté avant d'être rechargé.
Sans BCR, le BL est rejeté (règle métier X3).
"""
from django.db import models


class DocumentX3(models.Model):
    """
    Document X3 simulé : trace qu'une opération a été "transmise" à X3.

    Un document X3 correspond exactement à une
         opération terrain. La relation OneToOne garantit qu'une opération ne
         génère jamais deux documents X3 (idempotence du mock).

    Un BL référence le BCR de la même tournée sur le
         même PLV. Cette auto-référence permet de retrouver le BCR associé et
         de valider la cohérence BCR->BL.
    """
    TYPE_BCR     = "BCR"
    TYPE_BL      = "BL"
    TYPE_CHOICES = [
        (TYPE_BCR, "Bon de Commande Recharge"),
        (TYPE_BL,  "Bordereau de Livraison"),
    ]

    numero_x3     = models.CharField(max_length=40, unique=True)
    type_document = models.CharField(max_length=10, choices=TYPE_CHOICES)
    operation     = models.OneToOneField(
        "distribution.Operation",
        on_delete=models.CASCADE,
        related_name="document_x3",
    )
    bcr = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bls",
        limit_choices_to={"type_document": TYPE_BCR},
        help_text="BCR de référence (renseigné uniquement pour un BL).",
    )
    statut     = models.CharField(max_length=20, default="SYNCHRONISE")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table       = "mock_x3_document_x3"
        verbose_name   = "Document X3"
        verbose_name_plural = "Documents X3"
        indexes = [
            models.Index(fields=["type_document"]),
            models.Index(fields=["operation"]),
        ]

    def __str__(self) -> str:
        return f"{self.numero_x3} ({self.type_document}) : {self.statut}"
