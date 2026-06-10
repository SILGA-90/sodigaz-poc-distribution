"""Settings Django pour le POC SODIGAZ (developpement)."""
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "rest_framework",
    "rest_framework_gis",
    "corsheaders",
    "accounts",
    "distribution",
    "mock_x3",
    "rest_framework_simplejwt.token_blacklist",
    "auth_api",
    "sync_api",
    "supervision",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": env("DB_NAME"),
        "USER": env("DB_USER"),
        "PASSWORD": env("DB_PASSWORD"),
        "HOST": env("DB_HOST"),
        "PORT": env("DB_PORT"),
    }
}

AUTH_USER_MODEL = "accounts.Utilisateur"

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Ouagadougou"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOW_ALL_ORIGINS = DEBUG

DEV_ACCESS_CODE = env("DEV_ACCESS_CODE", default="")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # 3 tentatives par heure par utilisateur sur l'endpoint dev-access
        "dev_access": "3/hour",
        # 5 tentatives par minute par IP sur l'endpoint login (anti brute-force)
        "login": "5/minute",
    },
}


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


# Redirections d'authentification pour la supervision web
LOGIN_URL = "/supervision/login/"
LOGIN_REDIRECT_URL = "/supervision/"
LOGOUT_REDIRECT_URL = "/supervision/login/"


# Limite de taille pour les uploads (5 Mo par photo, plus que suffisant
# pour une photo compressee cote mobile)
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024  # 5 Mo
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 Mo (pour le JSON sync)


# =============================================================================
# Point de depart des tournees : le depot SODIGAZ.
# Sert de point d'origine a l'heuristique du plus proche voisin qui calcule
# l'ordre de visite suggere (champ Etape.ordre_optimise).
#
# ATTENTION : ce sont des coordonnees PLAUSIBLES a Ouagadougou, PAS les vraies
# coordonnees du depot SODIGAZ. A remplacer par les coordonnees reelles quand
# elles seront connues. Format : (longitude, latitude).
# (zone industrielle de Kossodo, nord-est de Ouaga, a titre indicatif)
# =============================================================================
DEPOT_SODIGAZ = {
    "nom": "Depot SODIGAZ (coordonnees provisoires)",
    "longitude": -1.4900,
    "latitude": 12.4100,
}
