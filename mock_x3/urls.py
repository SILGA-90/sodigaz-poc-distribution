from django.urls import path

from . import views

app_name = "mock_x3"

urlpatterns = [
    path("programmes/", views.programme_du_jour, name="programmes-du-jour"),
    path("operations-realisees/", views.remonter_operation, name="remonter-operation"),
]
