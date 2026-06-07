"""Commande Django simulant l'export quotidien de Sage X3."""
import random
import uuid
from datetime import date as date_cls
from datetime import datetime, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import Role, Utilisateur
from distribution.circuit import appliquer_ordre_optimise
from distribution.models import (
    Anomalie,
    Etape,
    GraviteAnomalie,
    LigneProgramme,
    Plv,
    Produit,
    Programme,
    StatutAnomalie,
    StatutProgramme,
    TypeProgramme,
    Vehicule,
)

_TYPES_ANOMALIE = [
    "Client absent",
    "Probleme acces depot",
    "Bouteille endommagee",
    "Quantite insuffisante en stock camion",
    "Refus de reception client",
]


class Command(BaseCommand):
    help = "Genere les programmes du jour (simulation Sage X3)."

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str,
            help="Date du programme (YYYY-MM-DD). Par defaut : aujourd'hui.")
        parser.add_argument("--livreur", type=str,
            help="Code livreur specifique. Par defaut : tous.")
        parser.add_argument("--reset", action="store_true",
            help="Soft-delete les programmes existants pour la date avant regeneration.")

    def handle(self, *args, **options):
        if options["date"]:
            try:
                date_prog = datetime.strptime(options["date"], "%Y-%m-%d").date()
            except ValueError as e:
                raise CommandError(f"Format de date invalide : {e}")
        else:
            date_prog = date_cls.today()

        livreurs_qs = Utilisateur.objects.filter(role=Role.LIVREUR, is_active=True)
        if options["livreur"]:
            livreurs_qs = livreurs_qs.filter(code_livreur=options["livreur"])
        livreurs = list(livreurs_qs)
        if not livreurs:
            raise CommandError("Aucun livreur actif trouve.")

        plvs = list(Plv.objects.filter(statut="ACTIF").select_related("client"))
        if len(plvs) < 3:
            raise CommandError(
                f"Pas assez de PLV actifs ({len(plvs)}). Lance d'abord 'seed_demo'."
            )
        vehicules = list(Vehicule.objects.filter(actif=True))
        produits_gaz = list(Produit.objects.filter(actif=True, code_x3__startswith='G'))
        if not produits_gaz:
            raise CommandError("Produits G* (gaz emballé) manquants. Lance d'abord 'seed_demo'.")

        if options["reset"]:
            # Soft-delete en cascade : anomalies d'abord, puis programmes.
            # Le trigger PostgreSQL met à jour last_modified sur chaque ligne ;
            # le mobile apprendra les suppressions via la liste "deleted" du pull.
            progs_a_supprimer = list(
                Programme.objects.filter(
                    date_programme=date_prog,
                    utilisateur__in=livreurs,
                    is_deleted=False,
                ).values_list("id", flat=True)
            )
            Anomalie.objects.filter(programme_id__in=progs_a_supprimer, is_deleted=False).update(is_deleted=True)
            count = Programme.objects.filter(id__in=progs_a_supprimer).update(is_deleted=True)
            self.stdout.write(self.style.WARNING(
                f"Reset : {count} programme(s) marque(s) supprimes (soft-delete)."
            ))

        # Heure de base pour le numéro : simule l'heure d'export depuis X3.
        # Chaque livreur décale de 1 minute pour garantir l'unicité du numéro.
        heure_base = datetime.now()

        compteur = 0
        with transaction.atomic():
            for i, livreur in enumerate(livreurs):
                type_prog = (
                    TypeProgramme.COLLECTE if i % 2 == 0 else TypeProgramme.RESTITUTION
                )

                # Format Sage X3 : PRG-COL-20260607-1502 (HHMM en prod).
                # La simulation trouve le premier HHMMSS libre pour éviter les doublons.
                prefix = f"PRG-{type_prog[:3]}-{date_prog.strftime('%Y%m%d')}-"
                candidat = heure_base + timedelta(seconds=i)
                while Programme.objects.filter(
                    numero_x3=prefix + candidat.strftime("%H%M%S"),
                    is_deleted=False,
                ).exists():
                    candidat += timedelta(seconds=1)
                numero_x3 = prefix + candidat.strftime("%H%M%S")
                vehicule = random.choice(vehicules) if vehicules else None

                programme = Programme.objects.create(
                    numero_x3=numero_x3,
                    utilisateur=livreur,
                    vehicule=vehicule,
                    date_programme=date_prog,
                    type_programme=type_prog,
                    statut=StatutProgramme.PLANIFIE,
                )

                nb_etapes = random.randint(3, min(5, len(plvs)))
                plvs_choisis = random.sample(plvs, nb_etapes)
                for ordre, plv in enumerate(plvs_choisis, start=1):
                    etape = Etape.objects.create(
                        programme=programme,
                        plv=plv,
                        ordre_prevu=ordre,
                    )
                    # COLLECTE : pas de LigneProgramme — quantités non planifiées à l'avance.
                    # RESTITUTION : lignes G* avec quantite_prevue.
                    if type_prog == TypeProgramme.RESTITUTION:
                        nb_articles = random.randint(1, min(3, len(produits_gaz)))
                        for prod in random.sample(produits_gaz, nb_articles):
                            LigneProgramme.objects.create(
                                etape=etape,
                                produit=prod,
                                quantite_prevue=random.randint(5, 30),
                            )

                # Calcul de l'ordre de visite suggere (plus proche voisin)
                appliquer_ordre_optimise(programme)

                # Anomalies de demo : 1 par programme (pour permettre de tester la supervision)
                if options["reset"]:
                    plv_anomalie = random.choice(plvs_choisis)
                    Anomalie.objects.create(
                        uuid=uuid.uuid4(),
                        programme=programme,
                        plv=plv_anomalie,
                        type_anomalie=random.choice(_TYPES_ANOMALIE),
                        gravite=random.choice([GraviteAnomalie.FAIBLE, GraviteAnomalie.MOYENNE, GraviteAnomalie.ELEVEE]),
                        description="Anomalie generee automatiquement pour la demonstration.",
                        statut=StatutAnomalie.OUVERTE,
                        date_heure=timezone.now(),
                    )

                compteur += 1
                self.stdout.write(
                    f"  {livreur.code_livreur} : {numero_x3} "
                    f"({type_prog}, {nb_etapes} etapes)"
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"\n{compteur} programme(s) genere(s) pour le {date_prog}."
            )
        )
