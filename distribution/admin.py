"""Admin Django pour la visualisation des donnees pendant le developpement."""
from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import (
    Anomalie, Etape, LigneOperation, LigneProgramme, Operation,
    Article, Photo, Plv, Programme, Vehicule,
)
from .models import Client as ClientModel


@admin.register(ClientModel)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("code_x3", "raison_sociale", "type_client", "actif")
    list_filter = ("type_client", "actif")
    search_fields = ("code_x3", "raison_sociale")


@admin.register(Plv)
class PlvAdmin(GISModelAdmin):
    list_display = ("libelle", "client", "statut")
    list_filter = ("statut", "client__type_client")
    search_fields = ("libelle", "client__raison_sociale")
    autocomplete_fields = ("client",)


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ("code_x3", "libelle", "type_emballage", "prix_unitaire", "actif")
    list_filter = ("type_emballage", "actif")
    search_fields = ("code_x3", "libelle")


@admin.register(Vehicule)
class VehiculeAdmin(admin.ModelAdmin):
    list_display = ("immatriculation", "type", "capacite", "actif")
    list_filter = ("actif",)
    search_fields = ("immatriculation",)


class EtapeInline(admin.TabularInline):
    model = Etape
    extra = 0
    fields = ("ordre_prevu", "plv", "statut_visite")
    autocomplete_fields = ("plv",)


@admin.register(Programme)
class ProgrammeAdmin(admin.ModelAdmin):
    list_display = (
        "numero_x3", "date_programme", "utilisateur", "type_programme",
        "statut", "is_deleted",
    )
    list_filter = ("type_programme", "statut", "date_programme")
    search_fields = ("numero_x3", "utilisateur__username", "utilisateur__code_livreur")
    autocomplete_fields = ("utilisateur", "vehicule")
    inlines = [EtapeInline]


class LigneProgrammeInline(admin.TabularInline):
    model = LigneProgramme
    extra = 0


@admin.register(Etape)
class EtapeAdmin(admin.ModelAdmin):
    list_display = ("programme", "ordre_prevu", "plv", "statut_visite")
    list_filter = ("statut_visite",)
    search_fields = ("programme__numero_x3", "plv__libelle")
    autocomplete_fields = ("programme", "plv")
    inlines = [LigneProgrammeInline]


class LigneOperationInline(admin.TabularInline):
    model = LigneOperation
    extra = 0


class PhotoInline(admin.TabularInline):
    model = Photo
    extra = 0
    fk_name = "operation"
    fields = ("type_photo", "fichier", "date_heure")


@admin.register(Operation)
class OperationAdmin(GISModelAdmin):
    list_display = (
        "uuid", "etape", "type_operation", "sous_type", "date_heure",
        "montant_total", "est_encaissee",
    )
    list_filter = ("type_operation", "sous_type", "est_encaissee", "mode_paiement")
    search_fields = ("uuid",)
    autocomplete_fields = ("etape",)
    inlines = [LigneOperationInline, PhotoInline]
    readonly_fields = ("last_modified",)


@admin.register(Anomalie)
class AnomalieAdmin(GISModelAdmin):
    list_display = ("uuid", "programme", "type_anomalie", "gravite", "statut", "date_heure")
    list_filter = ("statut", "gravite")
    search_fields = ("uuid", "type_anomalie", "description")
    autocomplete_fields = ("programme", "plv")


@admin.register(Photo)
class PhotoAdmin(GISModelAdmin):
    list_display = ("uuid", "type_photo", "operation", "anomalie", "date_heure")
    list_filter = ("type_photo",)
