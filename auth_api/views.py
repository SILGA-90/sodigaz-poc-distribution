"""
Vues de l'API d'authentification.

Endpoints :
  POST /api/auth/login/          : echange code_livreur + password contre 2 tokens
  POST /api/auth/refresh/        : echange refresh token contre nouveau access token
  GET  /api/auth/me/             : retourne les infos du livreur connecte
  POST /api/auth/dev-access/     : verifie le code d'acces au mode developpeur mobile
"""
import hmac

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import LivreurTokenObtainPairSerializer, UtilisateurMeSerializer


class LivreurTokenObtainPairView(TokenObtainPairView):
    """Login par code_livreur + password."""
    serializer_class = LivreurTokenObtainPairSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """Retourne les infos de l'utilisateur connecte (verifie que le JWT marche)."""
    serializer = UtilisateurMeSerializer(request.user)
    return Response(serializer.data)


class DevAccessThrottle(UserRateThrottle):
    """3 tentatives par heure par utilisateur — limite le brute-force."""
    scope = "dev_access"


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([DevAccessThrottle])
def verify_dev_access(request):
    """
    Verifie le code d'acces au mode developpeur mobile.

    Le code de reference est lu depuis la variable d'environnement DEV_ACCESS_CODE
    (jamais dans le code source). La comparaison est en temps constant (hmac.compare_digest)
    pour eviter les attaques par timing.

    Reponses :
      200  {"ok": true}   — code correct
      403  {"ok": false}  — code incorrect (compte dans le quota de 3/heure)
      503  {}             — DEV_ACCESS_CODE non configure cote serveur
    """
    stored = settings.DEV_ACCESS_CODE
    if not stored:
        return Response({"detail": "Mode developpeur non configure."}, status=503)

    submitted = str(request.data.get("code", ""))
    valid = hmac.compare_digest(submitted, stored)

    if valid:
        return Response({"ok": True})
    return Response({"ok": False}, status=403)
