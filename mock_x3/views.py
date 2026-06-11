"""
Vues de l'API simulant Sage X3.

Ce module expose deux endpoints qui imitent l'interface qu'offrirait Sage X3
à une intégration réelle :
  - GET  /api/mock-x3/programmes/ : liste des programmes du jour pour un livreur
  - POST /api/mock-x3/operations/ : accuse réception d'une opération remontée

Dans une vraie intégration, ces endpoints
seraient fournis par Sage X3 via son API REST. Dans le POC, on les simule
localement pour tester le flux complet (génération -> sync mobile -> remontée)
sans disposer d'une licence X3.

Un livreur ne doit pouvoir voir
que ses propres programmes. Superviseurs et admins peuvent voir tous les
programmes : nécessaire pour les démos et la supervision.
"""
from datetime import date as date_cls
from datetime import datetime

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from accounts.models import Role
from distribution.models import Client, Programme

from .serializers import (
    EtapeProgrammeSerializer,
    LignePrevueSerializer,
    OperationRemonteeSerializer,
    ProgrammeJourSerializer,
)


@api_view(["GET"])
def programme_du_jour(request):
    """
    Retourne les programmes du jour pour un livreur donné.
    Simule le format de réponse qu'offrirait l'API Sage X3.

    Permet aux démonstrations de consulter
         des programmes historiques sans changer la date système.

    Un livreur ne peut accéder qu'à
         ses propres programmes pour éviter les fuites d'information entre
         équipes. Le superviseur peut consulter n'importe quel livreur.
    """
    code_livreur = request.query_params.get("code_livreur")
    date_str     = request.query_params.get("date")

    if not code_livreur:
        return Response(
            {"detail": "Paramètre 'code_livreur' requis."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Contrôle d'accès : un livreur ne peut consulter que ses propres programmes
    u = request.user
    if not u.is_superuser and u.role not in (Role.SUPERVISEUR, Role.ADMIN):
        if u.code_livreur != code_livreur:
            return Response(
                {"detail": "Vous n'êtes pas autorisé à consulter ce programme."},
                status=status.HTTP_403_FORBIDDEN,
            )

    if date_str:
        try:
            date_prog = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response(
                {"detail": "Format de date invalide, attendu YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    else:
        date_prog = date_cls.today()

    qs = Programme.objects.filter(
        utilisateur__code_livreur=code_livreur,
        date_programme=date_prog,
        is_deleted=False,
    ).select_related("utilisateur", "vehicule")

    programmes = list(qs)
    if not programmes:
        return Response(
            {
                "detail": (
                    f"Aucun programme trouvé pour le livreur {code_livreur} "
                    f"à la date {date_prog.isoformat()}."
                )
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    payload = []
    for prog in programmes:
        etapes_data = []
        etapes_qs = (
            prog.etapes.filter(is_deleted=False)
            .select_related("plv", "plv__client")
            .order_by("ordre_prevu")
        )
        for etape in etapes_qs:
            lignes_data = []
            for ligne in etape.lignes_prevues.filter(is_deleted=False).select_related("produit"):
                lignes_data.append(
                    LignePrevueSerializer({
                        "code_produit_x3": ligne.produit.code_x3,
                        "libelle_produit": ligne.produit.libelle,
                        "quantite_prevue": ligne.quantite_prevue,
                    }).data
                )

            etapes_data.append(
                EtapeProgrammeSerializer({
                    "ordre":                 etape.ordre_prevu,
                    "code_client_x3":        etape.plv.client.code_x3,
                    "raison_sociale_client": etape.plv.client.raison_sociale,
                    "libelle_plv":           etape.plv.libelle,
                    "adresse_plv":           etape.plv.adresse or "",
                    "latitude":              etape.plv.localisation.y,
                    "longitude":             etape.plv.localisation.x,
                    "lignes_prevues":        lignes_data,
                }).data
            )

        payload.append(
            ProgrammeJourSerializer({
                "numero_x3":               prog.numero_x3,
                "code_livreur":            prog.utilisateur.code_livreur,
                "date_programme":          prog.date_programme,
                "type_programme":          prog.type_programme,
                "immatriculation_vehicule": (
                    prog.vehicule.immatriculation if prog.vehicule else None
                ),
                "etapes": etapes_data,
            }).data
        )

    return Response({"programmes": payload}, status=status.HTTP_200_OK)


@api_view(["POST"])
def remonter_operation(request):
    """
    Simule la réception d'une opération par Sage X3.
    Valide les données et retourne un accusé de réception avec un
    numéro de bordereau fictif.

    Dans le POC, cet endpoint ne
         crée pas de document X3 réel : il valide le format et retourne
         un accusé avec un numéro fictif basé sur l'UUID de l'opération.
         La création de DocumentX3 se fait dans x3_sync.py (appelé après push).
    """
    serializer = OperationRemonteeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    get_object_or_404(Client, code_x3=data["code_client_x3"])

    prefixes = {
        "COLLECTE":          "BC",
        "RESTITUTION":       "BR",
        "LIVRAISON_DIRECTE": "BL",
        "CONSIGNE":          "BCN",
    }
    numero_bordereau = f"{prefixes[data['type_operation']]}-{data['uuid'].hex[:8].upper()}"

    return Response(
        {
            "statut":                "ACCUSE_RECEPTION",
            "uuid_operation":        str(data["uuid"]),
            "numero_bordereau_x3":   numero_bordereau,
            "horodatage_reception":  datetime.now().isoformat(),
        },
        status=status.HTTP_200_OK,
    )
