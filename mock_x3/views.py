"""Vues de l'API simulant Sage X3."""
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
    code_livreur = request.query_params.get("code_livreur")
    date_str = request.query_params.get("date")

    if not code_livreur:
        return Response(
            {"detail": "Parametre 'code_livreur' requis."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Un livreur ne peut consulter que ses propres programmes.
    # Superviseurs et admins peuvent consulter n'importe quel livreur.
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
                    f"Aucun programme trouve pour le livreur {code_livreur} "
                    f"a la date {date_prog.isoformat()}."
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
                    LignePrevueSerializer(
                        {
                            "code_produit_x3": ligne.produit.code_x3,
                            "libelle_produit": ligne.produit.libelle,
                            "quantite_prevue": ligne.quantite_prevue,
                        }
                    ).data
                )

            etapes_data.append(
                EtapeProgrammeSerializer(
                    {
                        "ordre": etape.ordre_prevu,
                        "code_client_x3": etape.plv.client.code_x3,
                        "raison_sociale_client": etape.plv.client.raison_sociale,
                        "libelle_plv": etape.plv.libelle,
                        "adresse_plv": etape.plv.adresse or "",
                        "latitude": etape.plv.localisation.y,
                        "longitude": etape.plv.localisation.x,
                        "lignes_prevues": lignes_data,
                    }
                ).data
            )

        payload.append(
            ProgrammeJourSerializer(
                {
                    "numero_x3": prog.numero_x3,
                    "code_livreur": prog.utilisateur.code_livreur,
                    "date_programme": prog.date_programme,
                    "type_programme": prog.type_programme,
                    "immatriculation_vehicule": (
                        prog.vehicule.immatriculation if prog.vehicule else None
                    ),
                    "etapes": etapes_data,
                }
            ).data
        )

    return Response({"programmes": payload}, status=status.HTTP_200_OK)


@api_view(["POST"])
def remonter_operation(request):
    serializer = OperationRemonteeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    get_object_or_404(Client, code_x3=data["code_client_x3"])

    prefixes = {
        "COLLECTE": "BC",
        "RESTITUTION": "BR",
        "LIVRAISON_DIRECTE": "BL",
        "CONSIGNE": "BCN",
    }
    numero_bordereau = f"{prefixes[data['type_operation']]}-{data['uuid'].hex[:8].upper()}"

    return Response(
        {
            "statut": "ACCUSE_RECEPTION",
            "uuid_operation": str(data["uuid"]),
            "numero_bordereau_x3": numero_bordereau,
            "horodatage_reception": datetime.now().isoformat(),
        },
        status=status.HTTP_200_OK,
    )
