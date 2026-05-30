"""
Vues de l'API d'authentification.

Endpoints :
  POST /api/auth/login/    : echange code_livreur + password contre 2 tokens
  POST /api/auth/refresh/  : echange refresh token contre nouveau access token
  GET  /api/auth/me/       : retourne les infos du livreur connecte (test)
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
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
