from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("auth_api.urls")),
    path("api/mock-x3/", include("mock_x3.urls")),
    path("api/sync/", include("sync_api.urls")),
    path("supervision/", include("supervision.urls")),
]

# Servir les medias en developpement (en production, c'est nginx)
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
