"""
Admin Django pour le modèle Utilisateur personnalisé.

Enregistre UtilisateurAdmin qui étend UserAdmin pour exposer les champs
métier SODIGAZ (code_livreur, téléphone, rôle) dans l'interface d'admin.

UserAdmin gère déjà les champs Django Auth
(password hashing, permissions, groupes). En l'étendant, on conserve ces
fonctionnalités tout en ajoutant les champs métier dans une section séparée.
Si on utilisait ModelAdmin, on perdrait le formulaire de changement de mot
de passe et la gestion des permissions.
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Utilisateur


@admin.register(Utilisateur)
class UtilisateurAdmin(UserAdmin):
    list_display = ("username", "code_livreur", "first_name", "last_name", "role", "is_active")
    list_filter = ("role", "is_active", "is_staff")
    search_fields = ("username", "code_livreur", "first_name", "last_name")
    ordering = ("username",)

    # Ajout des champs personnalises dans les sections du formulaire admin
    fieldsets = UserAdmin.fieldsets + (
        ("Informations metier SODIGAZ", {
            "fields": ("code_livreur", "telephone", "role"),
        }),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Informations metier SODIGAZ", {
            "fields": ("code_livreur", "telephone", "role"),
        }),
    )
