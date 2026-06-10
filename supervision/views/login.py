"""
Vue de connexion avec limitation du nombre de tentatives par adresse IP.

Paramètres :
  RATE_LIMIT_MAX    — nombre de tentatives avant blocage (5)
  RATE_LIMIT_WINDOW — fenêtre de comptage en secondes (5 min)
  RATE_LIMIT_BLOCK  — durée de blocage en secondes (15 min)

Aucune dépendance externe : utilise uniquement le cache Django intégré
(LocMemCache par défaut, Redis/Memcached en production).
"""
import math

from django.contrib.auth.views import LoginView
from django.core.cache import cache

RATE_LIMIT_MAX    = 5    # tentatives
RATE_LIMIT_WINDOW = 300  # 5 minutes
RATE_LIMIT_BLOCK  = 900  # 15 minutes


def _get_client_ip(request) -> str:
    """Récupère l'IP réelle derrière un éventuel reverse proxy."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "0.0.0.0")


def _cache_key(ip: str) -> str:
    return f"login_fail:{ip}"


class RateLimitedLoginView(LoginView):
    """
    LoginView avec protection brute-force par IP.

    Après RATE_LIMIT_MAX tentatives échouées dans RATE_LIMIT_WINDOW secondes,
    l'IP est bloquée pendant RATE_LIMIT_BLOCK secondes. Un contexte
    ``login_blocked`` et ``retry_minutes`` est transmis au template pour
    afficher un message explicite.
    """

    def _attempts(self, request) -> int:
        return cache.get(_cache_key(_get_client_ip(request)), 0)

    def _is_blocked(self, request) -> bool:
        return self._attempts(request) >= RATE_LIMIT_MAX

    def _blocked_context(self, request) -> dict:
        remaining = cache.ttl(_cache_key(_get_client_ip(request))) if hasattr(cache, "ttl") else RATE_LIMIT_BLOCK
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
        ip  = _get_client_ip(self.request)
        key = _cache_key(ip)
        new_count = cache.get(key, 0) + 1
        ttl = RATE_LIMIT_BLOCK if new_count >= RATE_LIMIT_MAX else RATE_LIMIT_WINDOW
        cache.set(key, new_count, ttl)
        return super().form_invalid(form)

    def form_valid(self, form):
        # Connexion réussie : on remet le compteur à zéro.
        cache.delete(_cache_key(_get_client_ip(self.request)))
        return super().form_valid(form)
