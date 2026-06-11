"""
Routes d'authentification JWT pour l'application mobile.

Expose les quatre endpoints d'authentification utilisés par le mobile :
         - login/       : POST credentials -> access + refresh tokens
         - refresh/     : POST refresh -> nouveau access token (rotation)
         - me/          : GET profil de l'utilisateur connecté
         - dev-access/  : POST vérification PIN mode développeur (throttle 3/h)

Namespace explicite pour les reverse URL
(url('auth_api:login')) et pour éviter les collisions avec d'autres apps.
"""
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import LivreurTokenObtainPairView, me, verify_dev_access

app_name = "auth_api"

urlpatterns = [
    path("login/", LivreurTokenObtainPairView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("me/", me, name="me"),
    path("dev-access/", verify_dev_access, name="dev-access"),
]
