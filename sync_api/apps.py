from django.apps import AppConfig


class SyncApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "sync_api"
    verbose_name = "API de synchronisation offline-first"
