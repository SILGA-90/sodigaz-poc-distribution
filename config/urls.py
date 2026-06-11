"""
Routage URL racine du projet SODIGAZ.

Ce fichier déclare les quatre groupes de routes du projet :
         - /admin/          : interface d'administration Django
         - /api/auth/       : authentification JWT (login, refresh, me, dev-access)
         - /api/mock-x3/    : simulation Sage X3 (génération programmes)
         - /api/sync/       : synchronisation offline-first (pull, push, photos, clôture)
         - /supervision/    : interface web superviseur

La racine / n'a pas de contenu propre.
On redirige vers /supervision/ pour les navigateurs qui ouvrent l'IP directement.
Redirection non-permanente (302) pour pouvoir la changer facilement.

En développement, Django sert les médias
(photos uploadées) directement. En production, c'est Nginx qui servira
le répertoire MEDIA_ROOT : Django ne doit pas charger ce handler en prod.
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

urlpatterns = [
    path("", RedirectView.as_view(url="/supervision/", permanent=False)),
    path("admin/", admin.site.urls),
    path("api/auth/", include("auth_api.urls")),
    path("api/mock-x3/", include("mock_x3.urls")),
    path("api/sync/", include("sync_api.urls")),
    path("supervision/", include("supervision.urls")),
]

# Servir les medias en developpement (en production, c'est nginx)
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
