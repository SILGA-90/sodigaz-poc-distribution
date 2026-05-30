#!/bin/bash
# =============================================================================
# Installation de l'authentification JWT pour l'API mobile
# Usage : depuis ~/sodigaz_poc avec le venv active, bash install_auth_jwt.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : ce script doit etre execute depuis ~/sodigaz_poc"
    exit 1
fi

if [ -z "$VIRTUAL_ENV" ]; then
    echo "ERREUR : active d'abord le venv avec 'source venv/bin/activate'"
    exit 1
fi

# =============================================================================
echo ""
echo "=== Etape 1 : installation de djangorestframework-simplejwt ==="
pip install djangorestframework-simplejwt==5.3.1
echo "OK"

# =============================================================================
echo ""
echo "=== Etape 2 : ajout dans requirements.txt ==="
if ! grep -q "djangorestframework-simplejwt" requirements.txt; then
    echo "djangorestframework-simplejwt==5.3.1" >> requirements.txt
    echo "OK : ajoute"
else
    echo "Deja present"
fi

# =============================================================================
echo ""
echo "=== Etape 3 : creation de l'app auth_api ==="
mkdir -p auth_api/migrations
touch auth_api/__init__.py
touch auth_api/migrations/__init__.py

cat > auth_api/apps.py << 'PYEOF'
from django.apps import AppConfig


class AuthApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "auth_api"
    verbose_name = "API d'authentification"
PYEOF

# ----- serializers.py -----
cat > auth_api/serializers.py << 'PYEOF'
"""
Serializers pour l'authentification JWT.

Notre modele Utilisateur a `code_livreur` en plus de `username`. On veut que
le livreur puisse se connecter avec son code livreur (ce qu'il a en tete et
sur sa carte), pas avec un `username` technique.

D'ou le serializer custom : il accepte `code_livreur` + `password`, et resout
le username correspondant avant de deleguer a TokenObtainPairSerializer.
"""
from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

Utilisateur = get_user_model()


class LivreurTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Connexion par code_livreur au lieu de username."""

    username_field = "code_livreur"

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # On enrichit le token avec des claims utiles cote mobile
        token["code_livreur"] = user.code_livreur
        token["nom_complet"] = user.get_full_name() or user.username
        token["role"] = user.role
        return token


class UtilisateurMeSerializer(serializers.ModelSerializer):
    """Informations du livreur connecte (endpoint /me/)."""

    class Meta:
        model = Utilisateur
        fields = (
            "id", "username", "code_livreur", "first_name", "last_name",
            "telephone", "role", "is_active",
        )
        read_only_fields = fields
PYEOF

# ----- views.py -----
cat > auth_api/views.py << 'PYEOF'
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
PYEOF

# ----- urls.py -----
cat > auth_api/urls.py << 'PYEOF'
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import LivreurTokenObtainPairView, me

app_name = "auth_api"

urlpatterns = [
    path("login/", LivreurTokenObtainPairView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("me/", me, name="me"),
]
PYEOF

echo "OK : app auth_api creee"

# =============================================================================
echo ""
echo "=== Etape 4 : configuration de config/settings.py ==="

python3 << 'PYEOF'
from pathlib import Path
import re

settings_path = Path("config/settings.py")
content = settings_path.read_text()

# 1. Ajout de auth_api et rest_framework_simplejwt.token_blacklist dans INSTALLED_APPS
if '"auth_api"' not in content:
    content = re.sub(
        r'("mock_x3",\s*\n)(\])',
        r'\1    "rest_framework_simplejwt.token_blacklist",\n    "auth_api",\n\2',
        content,
    )
    print("  + auth_api et token_blacklist ajoutes aux INSTALLED_APPS")
else:
    print("  = auth_api deja present")

# 2. Ajout de la conf JWT en fin de fichier si absente
if "SIMPLE_JWT" not in content:
    jwt_config = """

# ============================================================================
# Configuration JWT (djangorestframework-simplejwt)
# ============================================================================
# - ACCESS_TOKEN courte vie (60 min) : envoye a chaque requete API
# - REFRESH_TOKEN longue vie (30 j) : echange contre un nouvel access token
# - ROTATE_REFRESH_TOKENS : on emet un nouveau refresh a chaque refresh
# - BLACKLIST_AFTER_ROTATION : l'ancien refresh devient invalide (anti-replay)
#
# En production, SIGNING_KEY doit etre une valeur secrete distincte de
# SECRET_KEY (ici on utilise SECRET_KEY pour simplifier le POC).
# ============================================================================

from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}
"""
    content += jwt_config
    print("  + Configuration SIMPLE_JWT ajoutee")
else:
    print("  = Configuration SIMPLE_JWT deja presente")

# 3. Remplacer la classe d'authentification par defaut dans REST_FRAMEWORK
# par JWT (SimpleJWT) au lieu de TokenAuthentication
old_auth = (
    '    "DEFAULT_AUTHENTICATION_CLASSES": [\n'
    '        "rest_framework.authentication.TokenAuthentication",\n'
    '        "rest_framework.authentication.SessionAuthentication",\n'
    '    ],'
)
new_auth = (
    '    "DEFAULT_AUTHENTICATION_CLASSES": [\n'
    '        "rest_framework_simplejwt.authentication.JWTAuthentication",\n'
    '        "rest_framework.authentication.SessionAuthentication",\n'
    '    ],'
)
if old_auth in content:
    content = content.replace(old_auth, new_auth)
    print("  + TokenAuthentication remplace par JWTAuthentication")
elif "JWTAuthentication" in content:
    print("  = JWTAuthentication deja en place")

settings_path.write_text(content)
print("OK")
PYEOF

# =============================================================================
echo ""
echo "=== Etape 5 : modification de config/urls.py ==="
cat > config/urls.py << 'PYEOF'
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("auth_api.urls")),
    path("api/mock-x3/", include("mock_x3.urls")),
]
PYEOF
echo "OK"

# =============================================================================
echo ""
echo "=== Etape 6 : migrations (pour la table token_blacklist) ==="
python manage.py migrate
echo "OK"

# =============================================================================
echo ""
echo "=============================================="
echo "INSTALLATION JWT TERMINEE."
echo "=============================================="
echo ""
echo "Tests a effectuer dans un autre terminal (apres avoir lance runserver) :"
echo ""
echo "# 1. Login avec un livreur existant"
echo "curl -X POST http://localhost:8000/api/auth/login/ \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"code_livreur\": \"LIV001\", \"password\": \"demo1234\"}'"
echo ""
echo "# 2. Tu recevras 'access' et 'refresh'. Copie 'access' pour la suite."
echo ""
echo "# 3. Test du token sur /me/"
echo "curl http://localhost:8000/api/auth/me/ \\"
echo "  -H 'Authorization: Bearer <COLLE_ICI_LE_ACCESS_TOKEN>'"
echo ""
echo "# 4. Refresh : echange le refresh token contre un nouveau access"
echo "curl -X POST http://localhost:8000/api/auth/refresh/ \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"refresh\": \"<COLLE_ICI_LE_REFRESH_TOKEN>\"}'"
echo ""
