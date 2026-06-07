"""
Package de vues de supervision.

Chaque module regroupe les vues par domaine fonctionnel :
  - dashboard  : tableau de bord, KPI, carte, activité
  - programmes : liste et détail des programmes
  - operations : liste, détail, export CSV
  - anomalies  : liste, détail, changement statut/gravité
  - misc       : déconnexion, rapport journalier

Les re-exports ici préservent la compatibilité avec urls.py (from . import views).
"""
from .dashboard import (
    dashboard,
    dashboard_carte_data,
    dashboard_stats_data,
    dashboard_activite_data,
)
from .programmes import programmes_list, programme_detail
from .operations import operations_list, operation_detail, operations_export_csv
from .anomalies import (
    anomalies_list,
    anomalie_detail,
    changer_statut_anomalie,
    changer_gravite_anomalie,
)
from .misc import logout_view, rapport_journee

__all__ = [
    "dashboard",
    "dashboard_carte_data",
    "dashboard_stats_data",
    "dashboard_activite_data",
    "programmes_list",
    "programme_detail",
    "operations_list",
    "operation_detail",
    "operations_export_csv",
    "anomalies_list",
    "anomalie_detail",
    "changer_statut_anomalie",
    "changer_gravite_anomalie",
    "logout_view",
    "rapport_journee",
]
