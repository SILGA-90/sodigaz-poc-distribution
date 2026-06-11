"""
Vue de connexion de l'interface de supervision.

Ce module fournit une vue de login protégée contre le brute-force par
limitation du nombre de tentatives par adresse IP.

       Paramètres de configuration :
         RATE_LIMIT_MAX    : tentatives avant blocage : 5
         RATE_LIMIT_WINDOW : fenêtre de comptage : 5 minutes (300 s)
         RATE_LIMIT_BLOCK  : durée de blocage : 15 minutes (900 s)

L'interface de supervision est exposée
sur le réseau local (Intranet). Une limitation par IP protège les comptes
superviseur contre les attaques par dictionnaire, sans nécessiter de
dépendance externe.

Stocker les compteurs de tentatives
en cache (LocMemCache par défaut, Redis/Memcached en production) évite des
écritures en base pour chaque tentative de login. Le cache supporte
nativement le TTL (expiration automatique), indispensable pour la fenêtre
glissante.

LoginView de Django gère
l'authentification, la redirection post-login, le token CSRF et le
template. On surcharge uniquement les méthodes get/post/form_invalid
pour injecter la logique de rate limiting sans réécrire la vue entière.

En production derrière un reverse proxy (Nginx),
l'IP réelle du client est dans le header X-Forwarded-For, pas dans
REMOTE_ADDR qui contiendrait l'IP du proxy.
"""
import math

from django.contrib.auth.views import LoginView
from django.core.cache import cache

RATE_LIMIT_MAX    = 5    # tentatives avant blocage
RATE_LIMIT_WINDOW = 300  # fenêtre de comptage en secondes (5 min)
RATE_LIMIT_BLOCK  = 900  # durée de blocage en secondes (15 min)


def _get_client_ip(request) -> str:
    """
    Récupère l'adresse IP réelle du client.
    Derrière un reverse proxy, REMOTE_ADDR est l'IP du proxy.
    X-Forwarded-For contient la chaîne des IPs traversées ;
    le premier élément est l'IP réelle du client.
    """
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "0.0.0.0")


def _cache_key(ip: str) -> str:
    """WHAT : Génère la clé de cache pour le compteur de tentatives d'une IP."""
    return f"login_fail:{ip}"


class RateLimitedLoginView(LoginView):
    """
    LoginView Django enrichie d'une protection brute-force par IP.

    Comportement :
      - Après RATE_LIMIT_MAX tentatives échouées dans RATE_LIMIT_WINDOW secondes,
        l'IP est bloquée pendant RATE_LIMIT_BLOCK secondes.
      - Les méthodes GET et POST vérifient le blocage avant de traiter la requête.
      - En cas de blocage, le template reçoit login_blocked=True et retry_minutes
        pour afficher un message explicite.
      - Une connexion réussie remet le compteur à zéro.

    form_invalid est appelé par
         LoginView quand les credentials sont invalides. C'est l'endroit correct
         pour incrémenter : pas dans post() : car form_invalid n'est pas appelé
         si la requête est bloquée avant.
    """

    def _attempts(self, request) -> int:
        """Nombre de tentatives échouées pour l'IP courante."""
        return cache.get(_cache_key(_get_client_ip(request)), 0)

    def _is_blocked(self, request) -> bool:
        """Retourne True si l'IP a dépassé le quota de tentatives."""
        return self._attempts(request) >= RATE_LIMIT_MAX

    def _blocked_context(self, request) -> dict:
        """
        Prépare le contexte template pour l'affichage du message de blocage.
        Si le backend de cache supporte ttl() (Redis), on calcule
             le temps restant précis. Sinon, on utilise RATE_LIMIT_BLOCK par défaut.
        """
        remaining     = cache.ttl(_cache_key(_get_client_ip(request))) if hasattr(cache, "ttl") else RATE_LIMIT_BLOCK
        retry_minutes = max(1, math.ceil((remaining or RATE_LIMIT_BLOCK) / 60))
        return {"login_blocked": True, "retry_minutes": retry_minutes}

    def get(self, request, *args, **kwargs):
        if self._is_blocked(request):
            ctx = self.get_context_data(**self._blocked_context(request))
            return self.render_to_response(ctx)
        return super().get(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        if self._is_blocked(request):
            ctx = self.get_context_data(**self._blocked_context(request))
            return self.render_to_response(ctx)
        return super().post(request, *args, **kwargs)

    def form_invalid(self, form):
        """Incrémente le compteur de tentatives échouées pour l'IP courante."""
        ip        = _get_client_ip(self.request)
        key       = _cache_key(ip)
        new_count = cache.get(key, 0) + 1
        # Si le quota est atteint, on applique le TTL de blocage long ;
        # sinon on applique la fenêtre courte (les tentatives expirent naturellement).
        ttl = RATE_LIMIT_BLOCK if new_count >= RATE_LIMIT_MAX else RATE_LIMIT_WINDOW
        cache.set(key, new_count, ttl)
        return super().form_invalid(form)

    def form_valid(self, form):
        """Connexion réussie : on remet le compteur à zéro pour l'IP."""
        cache.delete(_cache_key(_get_client_ip(self.request)))
        return super().form_valid(form)
