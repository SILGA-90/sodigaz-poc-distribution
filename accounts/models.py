"""
Modèle utilisateur personnalisé du POC SODIGAZ.

Étend AbstractUser de Django pour ajouter les champs métier propres à
SODIGAZ : code livreur terrain, téléphone et rôle applicatif.

Django permet deux approches : AbstractBaseUser (contrôle
total, plus complexe) et AbstractUser (ajout de champs à l'utilisateur
standard). On choisit AbstractUser car les mécanismes d'authentification
standard (password hashing, permissions, admin) conviennent parfaitement.
Déclarer ce modèle personnalisé dès le début est une bonne pratique Django :
migrer vers un modèle custom après le premier migrate est très difficile.
"""
from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    """
    Rôles applicatifs des utilisateurs.
    Un rôle unique par utilisateur simplifie le contrôle d'accès.
           - LIVREUR     : accès à l'API mobile (JWT) uniquement.
           - SUPERVISEUR : accès à l'interface web de supervision.
           - ADMIN       : accès complet (Django admin + supervision).
    """
    LIVREUR     = "LIVREUR",     "Livreur"
    SUPERVISEUR = "SUPERVISEUR", "Superviseur"
    ADMIN       = "ADMIN",       "Administrateur"


class Utilisateur(AbstractUser):
    """
    Utilisateur de l'application : livreur ou superviseur.

    Les superviseurs et admins n'ont pas de code
    livreur terrain. Null = pas un livreur actif. Le code sert d'identifiant
    court pour le login mobile (à la place du username long).

    Nom de table explicite en français pour
    cohérence avec le reste du schéma métier.
    """
    code_livreur = models.CharField(
        max_length=20, unique=True, null=True, blank=True,
        help_text="Code identifiant le livreur sur le terrain (NULL pour les non-livreurs)",
    )
    telephone = models.CharField(max_length=20, blank=True)
    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.LIVREUR,
    )

    class Meta:
        db_table     = "utilisateur"
        verbose_name = "Utilisateur"
        verbose_name_plural = "Utilisateurs"

    def __str__(self) -> str:
        if self.code_livreur:
            return f"{self.code_livreur} - {self.get_full_name() or self.username}"
        return self.get_full_name() or self.username
