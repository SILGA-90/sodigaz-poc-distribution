"""
Settings Django pour le POC SODIGAZ.

Ce fichier configure l'ensemble du projet Django : apps, base de données,
authentification JWT, CORS, sécurité HTTP, upload et localisation.
Toutes les valeurs sensibles sont lues depuis le fichier .env via
django-environ (SECRET_KEY, DB_*, JWT_SIGNING_KEY, DEV_ACCESS_CODE, CORS).

Le modèle PLV a un champ PointField (localisation
géographique). django.contrib.gis + postgis sont obligatoires pour ce type
de champ. Sans eux, les migrations échoueraient.

Le modèle utilisateur custom
ajoute le champ `code_livreur` (identifiant terrain) et `role`. Il doit
être déclaré avant la première migration : impossible à changer après.

Les horodatages des opérations terrain
doivent être en heure locale Ouagadougou (UTC+0, pas d'heure d'été). Les
livreurs saisissent à heure locale ; le superviseur lit en heure locale.
USE_TZ = True stocke en UTC en base mais convertit à l'affichage.

Une tournée dure en général 6-8 heures.
60 min est un bon équilibre entre sécurité (token court-vécu) et praticité
(le refresh automatique dans client.ts gère la rotation transparente).

À chaque refresh, un
nouveau refresh token est émis et l'ancien est blacklisté. Cela empêche
la réutilisation d'un refresh token volé (anti-replay). Nécessite l'app
rest_framework_simplejwt.token_blacklist.

Les requêtes Axios du mobile (React
Native) ne sont pas des requêtes navigateur : CORS ne les affecte pas.
On ne liste que les origines Expo Web (localhost:8081) pour les tests
navigateur. Ne jamais ouvrir CORS_ALLOW_ALL_ORIGINS en production.

Ce code est le PIN du mode
développeur. Ne JAMAIS le coder en dur : il serait extractible du bundle
Django (fichiers compilés, logs). Comparé via hmac.compare_digest()
(constant-time) dans auth_api/views.py.

Le payload JSON de synchronisation
peut contenir plusieurs opérations avec signatures SVG et coordonnées GPS.
La limite par défaut de Django (2.5 Mo) serait atteinte sur une tournée
dense. 10 Mo est largement suffisant.
"""
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
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS : jamais ouvert en production.
# En dev, lister explicitement les origines autorisées dans CORS_ALLOWED_ORIGINS.
# Le mobile React Native n'est pas un navigateur : CORS ne le concerne pas.
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[
    "http://localhost:8081",
    "http://127.0.0.1:8081",
])

DEV_ACCESS_CODE = env("DEV_ACCESS_CODE", default="")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "EXCEPTION_HANDLER": "config.exceptions.custom_exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        # 3 tentatives par heure par utilisateur sur l'endpoint dev-access
        "dev_access": "3/hour",
        # 3 tentatives par minute par IP sur l'endpoint login (anti brute-force)
        "login": "3/minute",
        # 60 cycles de sync par heure par livreur (1/min, très au-dessus de l'usage réel)
        "sync": "60/hour",
        # 300 uploads photo par heure (20 livraisons × 3 photos × marge de rejeu)
        "photo_upload": "300/hour",
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

# JWT_SIGNING_KEY DOIT être distinct de SECRET_KEY en production.
# Générer : python3 -c "import secrets; print(secrets.token_urlsafe(64))"
JWT_SIGNING_KEY = env("JWT_SIGNING_KEY", default=SECRET_KEY)

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": JWT_SIGNING_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}


# ============================================================================
# En-têtes de sécurité HTTP
# ============================================================================
# Actifs quel que soit le mode (navigateurs modernes les respectent toujours).
SECURE_BROWSER_XSS_FILTER    = True
SECURE_CONTENT_TYPE_NOSNIFF  = True
X_FRAME_OPTIONS              = "DENY"
SESSION_COOKIE_HTTPONLY      = True
CSRF_COOKIE_HTTPONLY         = True

# Actifs uniquement en production (DEBUG=False).
# En dev HTTP, forcer HTTPS/Secure casserait les sessions locales.
if not DEBUG:
    SECURE_SSL_REDIRECT             = True
    SECURE_HSTS_SECONDS             = 31536000    # 1 an
    SECURE_HSTS_INCLUDE_SUBDOMAINS  = True
    SECURE_HSTS_PRELOAD             = True
    SESSION_COOKIE_SECURE           = True
    CSRF_COOKIE_SECURE              = True

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


# =============================================================================
# Logging : écriture dans logs/django.log avec rotation automatique.
# - django.request (ERROR) : toutes les erreurs 500 avec stack trace complète.
# - django (WARNING)       : avertissements Django internes.
# - root (ERROR)           : toute exception non gérée dans le code projet.
# En dev (DEBUG=True) les logs partent aussi dans la console du terminal.
# Rotation : 3 fichiers × 5 Mo = 15 Mo max de logs conservés.
# =============================================================================
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{asctime} [{levelname}] {name}: {message}",
            "style": "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "simple": {
            "format": "[{levelname}] {message}",
            "style": "{",
        },
    },
    "handlers": {
        "fichier": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": LOGS_DIR / "django.log",
            "maxBytes": 5 * 1024 * 1024,
            "backupCount": 3,
            "formatter": "verbose",
            "encoding": "utf-8",
        },
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
    },
    "loggers": {
        "django.request": {
            "handlers": ["fichier", "console"] if DEBUG else ["fichier"],
            "level": "ERROR",
            "propagate": False,
        },
        "django": {
            "handlers": ["fichier", "console"] if DEBUG else ["fichier"],
            "level": "WARNING",
            "propagate": False,
        },
        "": {
            "handlers": ["fichier"],
            "level": "ERROR",
        },
    },
}
