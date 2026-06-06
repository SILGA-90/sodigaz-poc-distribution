"""
Modèle de simulation Sage X3.

DocumentX3 représente un document créé dans X3 en réponse à une opération
remontée par le mobile. Dans le mock, la génération est locale et immédiate.

  - COLLECTE → BCR (Bon de Collecte Recharge)
  - RESTITUTION → BL (Bordereau de Livraison), obligatoirement rattaché à un BCR
    existant sur le même PLV (client). Un BL sans BCR est exclu.
"""
from django.db import models


class DocumentX3(models.Model):
    TYPE_BCR = "BCR"
    TYPE_BL = "BL"
    TYPE_CHOICES = [
        (TYPE_BCR, "Bon de Collecte Recharge"),
        (TYPE_BL, "Bordereau de Livraison"),
    ]

    numero_x3 = models.CharField(max_length=40, unique=True)
    type_document = models.CharField(max_length=10, choices=TYPE_CHOICES)
    operation = models.OneToOneField(
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
        help_text="BCR de reference (renseigne uniquement pour un BL).",
    )
    statut = models.CharField(max_length=20, default="SYNCHRONISE")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "mock_x3_document_x3"
        verbose_name = "Document X3"
        verbose_name_plural = "Documents X3"
        indexes = [
            models.Index(fields=["type_document"]),
            models.Index(fields=["operation"]),
        ]

    def __str__(self) -> str:
        return f"{self.numero_x3} ({self.type_document}) — {self.statut}"
