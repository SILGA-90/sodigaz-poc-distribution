"""Admin pour le modele Utilisateur personnalise."""
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
