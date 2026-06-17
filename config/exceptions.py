"""
Gestionnaire d'exceptions global pour l'API Django REST Framework.

Sans ce handler, toute exception non anticipée (coupure DB, erreur PostGIS,
bug serveur) renvoie une page HTML 500 que le client mobile ne peut pas
parser — le décodeur JSON plante et l'erreur est perdue. Ce handler garantit
que l'API renvoie toujours du JSON, y compris en cas de panne interne.

Il complète le handler DRF par défaut (qui gère déjà les 400/401/403/404)
en ajoutant uniquement la couverture des exceptions non prévues (500).
"""
import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    """
    Intercepte toutes les exceptions levées dans les vues DRF.

    - Délègue d'abord au handler DRF standard (gère ValidationError,
      AuthenticationFailed, PermissionDenied, NotFound, Throttled…).
    - Si le handler standard retourne None (exception non reconnue = 500),
      logue le traceback complet et renvoie une réponse JSON générique
      sans exposer les détails internes au client.
    """
    response = exception_handler(exc, context)

    if response is None:
        view = context.get("view")
        logger.exception(
            "Exception non gérée dans %s : %s",
            view.__class__.__name__ if view else "vue inconnue",
            exc,
        )
        response = Response(
            {
                "status": "error",
                "detail": "Une erreur interne s'est produite. Réessayez dans quelques instants.",
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return response
