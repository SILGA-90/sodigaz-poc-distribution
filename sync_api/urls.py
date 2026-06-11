"""
Routes de synchronisation offline-first.

Expose les quatre endpoints du protocole pull/push :
         - pull/                        : POST lastPulledAt -> changes + timestamp
         - push/                        : POST changes (opérations/anomalies/photos)
         - photos/<uuid>/upload/        : POST multipart -> binaire photo
         - programmes/cloturer/         : POST uuids -> clôture de programmes

La clôture est envoyée avant le pull
dans le cycle syncAll(). Un endpoint séparé permet un traitement prioritaire
sans mélanger clôtures et données terrain dans le même payload.
"""
from django.urls import path

from . import views

app_name = "sync_api"

urlpatterns = [
    path("pull/", views.sync_pull, name="pull"),
    path("push/", views.sync_push, name="push"),
    path("photos/<uuid:uuid>/upload/", views.upload_photo, name="photo-upload"),
    path("programmes/cloturer/", views.cloturer_programmes, name="cloturer-programmes"),
]
