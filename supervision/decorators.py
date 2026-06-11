"""
Décorateurs d'autorisation pour l'interface de supervision web.

Ce module fournit le décorateur @superviseur_required qui protège les
vues de supervision contre l'accès par des comptes sans rôle SUPERVISEUR
ou ADMIN.

Les vues de supervision sont
des fonctions (non des classes), ce qui exclut les mixins CBV. Le
décorateur compose @login_required avec la vérification de rôle en une
seule annotation réutilisable.

Un livreur qui accèderait à /supervision/
par erreur (mauvaise URL, mauvais compte) reçoit un 403 explicite plutôt
qu'un 404. Le message "réservé aux superviseurs" est plus utile qu'une page
blanche.
"""
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
