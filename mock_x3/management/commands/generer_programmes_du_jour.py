"""Commande Django simulant l'export quotidien de Sage X3."""
import random
from datetime import date as date_cls
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role, Utilisateur
from distribution.models import (
    Etape,
    LigneProgramme,
    Plv,
    Produit,
    Programme,
    StatutProgramme,
    TypeProgramme,
    Vehicule,
)


class Command(BaseCommand):
    help = "Genere les programmes du jour (simulation Sage X3)."

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str,
            help="Date du programme (YYYY-MM-DD). Par defaut : aujourd'hui.")
        parser.add_argument("--livreur", type=str,
            help="Code livreur specifique. Par defaut : tous.")
        parser.add_argument("--reset", action="store_true",
            help="Supprime les programmes existants pour la date avant generation.")

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
        produits = list(Produit.objects.filter(actif=True))
        if not produits:
            raise CommandError("Aucun produit actif. Lance d'abord 'seed_demo'.")

        if options["reset"]:
            n, _ = Programme.objects.filter(
                date_programme=date_prog,
                utilisateur__in=livreurs,
            ).delete()
            self.stdout.write(self.style.WARNING(f"Reset : {n} programme(s) supprime(s)."))

        compteur = 0
        with transaction.atomic():
            for i, livreur in enumerate(livreurs):
                type_prog = (
                    TypeProgramme.COLLECTE if i % 2 == 0 else TypeProgramme.RESTITUTION
                )

                if Programme.objects.filter(
                    utilisateur=livreur,
                    date_programme=date_prog,
                    type_programme=type_prog,
                ).exists():
                    self.stdout.write(
                        self.style.NOTICE(
                            f"  {livreur.code_livreur} : programme {type_prog} "
                            f"deja existant pour le {date_prog}, ignore."
                        )
                    )
                    continue

                numero_x3 = f"PRG-{date_prog.strftime('%Y%m%d')}-{livreur.code_livreur}-{type_prog[:3]}"
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
                    if type_prog == TypeProgramme.RESTITUTION:
                        nb_articles = random.randint(1, min(3, len(produits)))
                        produits_choisis = random.sample(produits, nb_articles)
                        for prod in produits_choisis:
                            LigneProgramme.objects.create(
                                etape=etape,
                                produit=prod,
                                quantite_prevue=random.randint(5, 30),
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
