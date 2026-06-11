"""
Endpoints de synchronisation offline-first.

Wrappers HTTP minces qui délèguent toute la logique à SyncEngine (engine.py).

Flux nominal d'un cycle de synchronisation (côté mobile) :
  1. pushClotures()  -> clôturer les programmes finis avant de tirer les données
  2. pull()          -> récupérer les nouveautés serveur depuis lastPulledAt
  3. push()          -> envoyer les opérations/anomalies créées hors ligne

Authentification : JWT (djangorestframework-simplejwt).
Isolation livreur : un livreur ne voit et ne modifie QUE ses propres données.
"""
from django.db import models
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from distribution.models import Photo, Programme
from .engine import SyncEngine
from .push_serializers import PushPayloadSerializer


# ===========================================================================
# VUES HTTP — wrappers minces qui délèguent à SyncEngine
# ===========================================================================

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sync_pull(request):
    """
    Endpoint pull : renvoie le delta serveur depuis lastPulledAt.
    """
    last_pulled_at = request.data.get("lastPulledAt", 0) or 0
    return SyncEngine(request.user).build_pull_response(last_pulled_at)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sync_push(request):
    """
    Endpoint push : persiste les données créées hors ligne par le livreur.
    """
    serializer = PushPayloadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return SyncEngine(request.user).apply_push(
        changes      = serializer.validated_data["changes"],
        echec_etapes = serializer.validated_data.get("echec_etapes", []),
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_photo(request, uuid):
    """
    Reçoit le fichier image d'une photo dont la métadonnée a déjà été
    persistée via sync_push. Remplace le placeholder binaire créé lors du push.

    Le push JSON et l'upload multipart sont deux requêtes distinctes, ce qui
    permet de re-tenter l'upload seul si le réseau coupe en cours de transfert
    sans avoir à repousser toutes les données JSON.
    """
    if "fichier" not in request.FILES:
        return Response(
            {"detail": "Champ 'fichier' manquant dans le multipart."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    photo = Photo.objects.filter(uuid=uuid).filter(
        models.Q(operation__etape__programme__utilisateur=request.user)
        | models.Q(anomalie__programme__utilisateur=request.user)
    ).first()

    if photo is None:
        return Response(
            {"detail": "Photo introuvable ou non autorisee."},
            status=status.HTTP_404_NOT_FOUND,
        )

    fichier          = request.FILES["fichier"]
    photo.fichier    = fichier
    photo.taille_octets = fichier.size
    photo.save()

    return Response({
        "status":        "ok",
        "uuid":          str(photo.uuid),
        "url":           request.build_absolute_uri(photo.fichier.url),
        "taille_octets": photo.taille_octets,
    }, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cloturer_programmes(request):
    """
    Passe le statut d'un ou plusieurs programmes du livreur à CLOTURE
    et horodate l'heure de fin côté serveur.

    L'heure de clôture est générée ici plutôt que transmise par le mobile
    pour éviter les problèmes de format de date et de timezone. Elle fait
    foi pour le reporting supervision et le rapprochement X3.

    La clôture est envoyée en tête du cycle de synchronisation
    (syncAll = pushClotures -> pull -> push). Si elle était dans le push
    normal, le pull précédent pourrait écraser le statut CLOTURE local
    avec PLANIFIE/EN_COURS (version serveur encore non clôturée).
    """
    uuids = request.data.get("uuids", [])
    if not isinstance(uuids, list):
        return Response(
            {"status": "error", "detail": "Le champ 'uuids' doit etre une liste."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    heure_fin = timezone.now()
    count = 0
    for u in uuids:
        count += Programme.objects.filter(
            uuid=u, utilisateur=request.user, is_deleted=False,
        ).update(statut="CLOTURE", heure_fin=heure_fin)

    return Response({"status": "ok", "clotures": count}, status=status.HTTP_200_OK)
