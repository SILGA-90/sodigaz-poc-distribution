"""
Configuration de l'interface d'administration Django pour la distribution.

Ce module enregistre les modèles métier dans l'admin Django afin de
permettre la visualisation et la modification manuelle des données
pendant le développement et les démonstrations.

GISModelAdmin remplace
ModelAdmin pour les modèles ayant un PointField. Il intègre une
interface de saisie de coordonnées via OpenLayers dans le formulaire
d'admin : pratique pour positionner un PLV ou une opération manuellement.

last_modified est géré exclusivement
par le trigger PostgreSQL. Le rendre readonly dans l'admin empêche
toute modification accidentelle qui casserait le delta de synchronisation.
"""
from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import (
    Anomalie, Etape, LigneOperation, LigneProgramme, Operation,
    Article, Photo, Plv, Programme, Vehicule,
)
from .models import Client as ClientModel


@admin.register(ClientModel)
class ClientAdmin(admin.ModelAdmin):
    """WHAT : Admin Client : recherche par code X3 et raison sociale."""
    list_display  = ("code_x3", "raison_sociale", "type_client", "actif")
    list_filter   = ("type_client", "actif")
    search_fields = ("code_x3", "raison_sociale")


@admin.register(Plv)
class PlvAdmin(GISModelAdmin):
    """
    Admin PLV avec carte OpenLayers pour saisir/visualiser la localisation.
    Permet de cliquer sur la carte pour placer le point
         GPS du PLV plutôt que de saisir les coordonnées en texte.
    """
    list_display       = ("libelle", "client", "statut")
    list_filter        = ("statut", "client__type_client")
    search_fields      = ("libelle", "client__raison_sociale")
    autocomplete_fields = ("client",)


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    """WHAT : Admin Article : filtré par type d'emballage et état actif."""
    list_display  = ("code_x3", "libelle", "type_emballage", "prix_unitaire", "actif")
    list_filter   = ("type_emballage", "actif")
    search_fields = ("code_x3", "libelle")


@admin.register(Vehicule)
class VehiculeAdmin(admin.ModelAdmin):
    """WHAT : Admin Véhicule."""
    list_display  = ("immatriculation", "type", "capacite", "actif")
    list_filter   = ("actif",)
    search_fields = ("immatriculation",)


class EtapeInline(admin.TabularInline):
    """WHAT : Affiche les étapes directement dans le formulaire Programme."""
    model               = Etape
    extra               = 0
    fields              = ("ordre_prevu", "plv", "statut_visite")
    autocomplete_fields = ("plv",)


@admin.register(Programme)
class ProgrammeAdmin(admin.ModelAdmin):
    """
    Admin Programme avec les étapes en inline.
    Permet de voir et modifier les étapes d'un
         programme sans naviguer vers l'admin Etape : utile pour les démos.
    """
    list_display        = (
        "numero_x3", "date_programme", "utilisateur", "type_programme",
        "statut", "is_deleted",
    )
    list_filter         = ("type_programme", "statut", "date_programme")
    search_fields       = ("numero_x3", "utilisateur__username", "utilisateur__code_livreur")
    autocomplete_fields = ("utilisateur", "vehicule")
    inlines             = [EtapeInline]


class LigneProgrammeInline(admin.TabularInline):
    """WHAT : Lignes prévues dans le formulaire Etape."""
    model = LigneProgramme
    extra = 0


@admin.register(Etape)
class EtapeAdmin(admin.ModelAdmin):
    """WHAT : Admin Etape avec les lignes prévues en inline."""
    list_display        = ("programme", "ordre_prevu", "plv", "statut_visite")
    list_filter         = ("statut_visite",)
    search_fields       = ("programme__numero_x3", "plv__libelle")
    autocomplete_fields = ("programme", "plv")
    inlines             = [LigneProgrammeInline]


class LigneOperationInline(admin.TabularInline):
    """WHAT : Lignes réalisées dans le formulaire Opération."""
    model = LigneOperation
    extra = 0


class PhotoInline(admin.TabularInline):
    """WHAT : Photos rattachées à une opération (via FK operation)."""
    model    = Photo
    extra    = 0
    fk_name  = "operation"  # précise la FK à utiliser (l'autre FK pointe vers anomalie)
    fields   = ("type_photo", "fichier", "date_heure")


@admin.register(Operation)
class OperationAdmin(GISModelAdmin):
    """
    Admin Opération avec localisation GPS sur carte.
    Ne jamais écrire last_modified
         manuellement : le trigger PostgreSQL le gère.
    """
    list_display        = (
        "uuid", "etape", "type_operation", "sous_type", "date_heure",
        "montant_total", "est_encaissee",
    )
    list_filter         = ("type_operation", "sous_type", "est_encaissee", "mode_paiement")
    search_fields       = ("uuid",)
    autocomplete_fields = ("etape",)
    inlines             = [LigneOperationInline, PhotoInline]
    readonly_fields     = ("last_modified",)


@admin.register(Anomalie)
class AnomalieAdmin(GISModelAdmin):
    """WHAT : Admin Anomalie avec localisation GPS sur carte."""
    list_display        = ("uuid", "programme", "type_anomalie", "gravite", "statut", "date_heure")
    list_filter         = ("statut", "gravite")
    search_fields       = ("uuid", "type_anomalie", "description")
    autocomplete_fields = ("programme", "plv")


@admin.register(Photo)
class PhotoAdmin(GISModelAdmin):
    """WHAT : Admin Photo : identifie rapidement si la photo est liée à une opération ou anomalie."""
    list_display = ("uuid", "type_photo", "operation", "anomalie", "date_heure")
    list_filter  = ("type_photo",)
