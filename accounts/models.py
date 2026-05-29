"""Modele utilisateur personnalise."""
from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    LIVREUR = "LIVREUR", "Livreur"
    SUPERVISEUR = "SUPERVISEUR", "Superviseur"
    ADMIN = "ADMIN", "Administrateur"


class Utilisateur(AbstractUser):
    code_livreur = models.CharField(
        max_length=20, unique=True, null=True, blank=True,
        help_text="Code identifiant le livreur sur le terrain (NULL pour les non-livreurs)",
    )
    telephone = models.CharField(max_length=20, blank=True)
    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.LIVREUR,
    )

    class Meta:
        db_table = "utilisateur"
        verbose_name = "Utilisateur"
        verbose_name_plural = "Utilisateurs"

    def __str__(self) -> str:
        if self.code_livreur:
            return f"{self.code_livreur} - {self.get_full_name() or self.username}"
        return self.get_full_name() or self.username
