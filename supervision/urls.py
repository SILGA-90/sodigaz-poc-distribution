from django.contrib.auth.views import LoginView
from django.urls import path

from . import views

app_name = "supervision"

urlpatterns = [
    path("login/", LoginView.as_view(
        template_name="supervision/login.html",
        redirect_authenticated_user=True,
    ), name="login"),
    path("logout/", views.logout_view, name="logout"),

    path("", views.dashboard, name="dashboard"),
    path("api/carte/", views.dashboard_carte_data, name="carte-data"),
    path("api/stats/", views.dashboard_stats_data, name="stats-data"),
    path("rapport/", views.rapport_journee, name="rapport"),
    path("programmes/", views.programmes_list, name="programmes"),
    path("programmes/<int:programme_id>/", views.programme_detail, name="programme-detail"),
    path("operations/", views.operations_list, name="operations"),
    path("operations/export/", views.operations_export_csv, name="operations-export"),
    path("operations/<uuid:operation_uuid>/", views.operation_detail, name="operation-detail"),
    path("api/activite/", views.dashboard_activite_data, name="activite-data"),
    path("anomalies/", views.anomalies_list, name="anomalies"),
    path("anomalies/<int:anomalie_id>/", views.anomalie_detail, name="anomalie-detail"),
    path("anomalies/<int:anomalie_id>/statut/", views.changer_statut_anomalie, name="anomalie-statut"),
    path("anomalies/<int:anomalie_id>/gravite/", views.changer_gravite_anomalie, name="anomalie-gravite"),
]
