"""Decorateurs d'autorisation pour la supervision."""
from functools import wraps

from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied


def superviseur_required(view_func):
    """
    Restreint l'acces aux comptes de role SUPERVISEUR ou ADMIN (ou superuser).
    Un livreur connecte est rejete avec un 403.
    """
    @wraps(view_func)
    @login_required(login_url="supervision:login")
    def wrapped(request, *args, **kwargs):
        u = request.user
        if u.is_superuser or u.role in ("SUPERVISEUR", "ADMIN"):
            return view_func(request, *args, **kwargs)
        raise PermissionDenied("Cette interface est reservee aux superviseurs.")
    return wrapped
