"""
Routage URL de l'interface de supervision.

Ce module définit les URLs de toutes les pages et endpoints AJAX de
l'interface web superviseur. Le préfixe /supervision/ est ajouté dans
config/urls.py.

Le namespace permet d'utiliser {% url
'supervision:dashboard' %} dans les templates plutôt que des URLs en
dur. Les templates restent valides si le préfixe change dans urls.py.

Structure des routes :
  - /login/  et /logout/        : authentification session Django
  - /                           : tableau de bord principal (KPIs + carte)
  - /api/*                      : endpoints AJAX (polling 15 s, Chart.js)
  - /carte/                     : cartographie plein écran
  - /livreurs/                  : tableau de bord par livreur
  - /rapport/                   : rapport journalier imprimable
  - /statistiques/              : tendances multi-jours
  - /programmes/                : liste des programmes
  - /programmes/<id>/           : détail d'un programme
  - /operations/                : liste des opérations
  - /operations/export/         : export CSV
  - /operations/<uuid>/         : détail d'une opération
  - /anomalies/                 : liste des anomalies
  - /anomalies/<id>/            : détail d'une anomalie
  - /anomalies/<id>/statut/     : action : changer statut
  - /anomalies/<id>/gravite/    : action : changer gravité
"""
from django.urls import path

from . import views
from .views.login import RateLimitedLoginView

app_name = "supervision"

urlpatterns = [
    # Authentification
    path("login/", RateLimitedLoginView.as_view(
        template_name="supervision/login.html",
        redirect_authenticated_user=True,
    ), name="login"),
    path("logout/", views.logout_view, name="logout"),

    # Tableau de bord principal
    path("", views.dashboard, name="dashboard"),
    path("api/carte/",            views.dashboard_carte_data,        name="carte-data"),
    path("api/stats/",            views.dashboard_stats_data,        name="stats-data"),
    path("api/activite/",         views.dashboard_activite_data,     name="activite-data"),
    path("api/activite-recente/", views.dashboard_activite_recente,  name="activite-recente"),
    path("api/bilan-articles/",   views.dashboard_bilan_articles_data, name="bilan-articles-data"),

    # Pages de supervision
    path("carte/",       views.carte_plein_ecran,    name="carte"),
    path("livreurs/",    views.tableau_bord_livreurs, name="livreurs"),
    path("rapport/",     views.rapport_journee,       name="rapport"),
    path("statistiques/", views.statistiques,         name="statistiques"),

    # Programmes
    path("programmes/",                 views.programmes_list,   name="programmes"),
    path("programmes/<int:programme_id>/", views.programme_detail, name="programme-detail"),

    # Opérations
    path("operations/",                          views.operations_list,        name="operations"),
    path("operations/export/",                   views.operations_export_csv,  name="operations-export"),
    path("operations/<uuid:operation_uuid>/",    views.operation_detail,       name="operation-detail"),

    # Anomalies
    path("anomalies/",                             views.anomalies_list,           name="anomalies"),
    path("anomalies/<int:anomalie_id>/",           views.anomalie_detail,          name="anomalie-detail"),
    path("anomalies/<int:anomalie_id>/statut/",    views.changer_statut_anomalie,  name="anomalie-statut"),
    path("anomalies/<int:anomalie_id>/gravite/",   views.changer_gravite_anomalie, name="anomalie-gravite"),
]
