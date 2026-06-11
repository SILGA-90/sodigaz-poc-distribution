"""
Routes de l'API simulant Sage X3.

Expose les deux endpoints du mock X3 :
         - programmes/            : GET liste des programmes du jour (descendant X3 -> mobile)
         - operations-realisees/  : POST remontée d'une opération terrain (ascendant mobile -> X3)

Namespace explicite pour les reverse URL et pour
distinguer clairement ces routes simulées des routes de l'API de sync
réelle. En production, ces endpoints seraient remplacés par l'intégration
Sage X3 réelle.
"""
from django.urls import path

from . import views

app_name = "mock_x3"

urlpatterns = [
    path("programmes/", views.programme_du_jour, name="programmes-du-jour"),
    path("operations-realisees/", views.remonter_operation, name="remonter-operation"),
]
