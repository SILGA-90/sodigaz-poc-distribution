"""
Vues de l'API d'authentification.

Ce module expose quatre endpoints d'authentification :
  POST /api/auth/login/      : échange code_livreur + password contre 2 tokens JWT
  POST /api/auth/refresh/    : rafraîchit l'access token à partir du refresh token
  GET  /api/auth/me/         : retourne les infos de l'utilisateur connecté
  POST /api/auth/dev-access/ : vérifie le code d'accès au mode développeur mobile

L'application mobile est offline-first : le token JWT
est stocké localement (SecureStore) et joint à chaque requête API dans le
header Authorization. Contrairement aux sessions Django (cookies), le JWT
fonctionne sans état côté serveur et survit aux redémarrages du serveur.

L'API est accessible depuis des appareils mobiles non maîtrisés.
Les throttles limitent le brute-force sur les credentials et sur le PIN
dev sans bloquer les utilisateurs légitimes.
"""
import hmac

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import LivreurTokenObtainPairSerializer, UtilisateurMeSerializer


class LoginRateThrottle(AnonRateThrottle):
    """
    Limite les tentatives de login à 5 par minute par adresse IP.
    Anti brute-force sur les credentials livreur. 5/min est suffisant
    pour un utilisateur légitime (l'app ne retente jamais automatiquement)
    et bloquant pour un attaquant par dictionnaire.
    """
    scope = "login"


class LivreurTokenObtainPairView(TokenObtainPairView):
    """
    Login par code_livreur + password : retourne access + refresh tokens.
    Le serializer custom surcharge le
    champ username_field pour accepter code_livreur comme identifiant,
    et enrichit le payload JWT avec les informations livreur (role, etc.).
    """
    serializer_class = LivreurTokenObtainPairSerializer
    throttle_classes = [LoginRateThrottle]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """
    Retourne les informations de l'utilisateur actuellement connecté.
    Utilisé par le mobile au démarrage pour vérifier que le JWT stocké
    est encore valide et récupérer les données profil (code_livreur, role).
    """
    serializer = UtilisateurMeSerializer(request.user)
    return Response(serializer.data)


class DevAccessThrottle(UserRateThrottle):
    """
    Limite les tentatives de vérification du PIN dev à 3 par heure par
    utilisateur JWT.
    Le PIN dev protège l'accès à l'écran Debug BDD (reset de la base
    locale). 3/h rend le brute-force impraticable (espace de ~6 chiffres)
    tout en autorisant quelques erreurs de frappe légitimes.
    """
    scope = "dev_access"


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([DevAccessThrottle])
def verify_dev_access(request):
    """
    Vérifie le code d'accès au mode développeur mobile.

    Le PIN n'est jamais embarqué dans le
    bundle JS de l'app (il serait extractible par reverse engineering).
    Il vit uniquement dans la variable d'environnement DEV_ACCESS_CODE
    du serveur Django. L'app envoie le code saisi par l'utilisateur et
    reçoit ok:true / ok:false.

    La comparaison de chaînes ordinaire (==) est
    vulnérable aux attaques par timing (un attaquant peut mesurer le temps
    de réponse pour deviner le PIN caractère par caractère). compare_digest
    garantit un temps constant quel que soit le degré de correspondance.

    Réponses :
      200  {"ok": true}   : code correct
      403  {"ok": false}  : code incorrect (compte dans le quota de 3/heure)
      503  {}             : DEV_ACCESS_CODE non configuré côté serveur
    """
    stored = settings.DEV_ACCESS_CODE
    if not stored:
        return Response({"detail": "Mode développeur non configuré."}, status=503)

    submitted = str(request.data.get("code", ""))
    valid = hmac.compare_digest(submitted, stored)

    if valid:
        return Response({"ok": True})
    return Response({"ok": False}, status=403)
