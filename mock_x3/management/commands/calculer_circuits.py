"""
Commande Django de recalcul des circuits (ordre de visite optimisé).

Cette commande recalcule et persiste l'ordre de visite optimal
(heuristique du plus proche voisin) sur les étapes des programmes
existants, via distribution.circuit.appliquer_ordre_optimise().

Le recalcul est utile dans deux cas :
  1. Des programmes ont été créés avant l'ajout de la fonctionnalité de circuit.
  2. Les coordonnées du dépôt SODIGAZ (settings.DEPOT_SODIGAZ) ont été corrigées
     et on veut rejouer le calcul sans supprimer les programmes.
  Dans le flux normal, generer_programmes_du_jour appelle appliquer_ordre_optimise
  automatiquement à la création de chaque programme.

Usage :
    python manage.py calculer_circuits
    python manage.py calculer_circuits --date 2026-06-02
    python manage.py calculer_circuits --livreur LIV001
    python manage.py calculer_circuits --verbose
"""
from datetime import date as date_cls
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from distribution.circuit import appliquer_ordre_optimise
from distribution.models import Programme


class Command(BaseCommand):
    help = "Recalcule l'ordre de visite suggéré (plus proche voisin)."

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str,
            help="Date des programmes (YYYY-MM-DD). Par défaut : aujourd'hui.")
        parser.add_argument("--livreur", type=str,
            help="Code livreur spécifique. Par défaut : tous.")
        parser.add_argument("--verbose", action="store_true",
            help="Affiche le détail du circuit calculé (ordre + distances en mètres).")

    def handle(self, *args, **options):
        if options["date"]:
            try:
                date_prog = datetime.strptime(options["date"], "%Y-%m-%d").date()
            except ValueError as e:
                raise CommandError(f"Format de date invalide : {e}")
        else:
            date_prog = date_cls.today()

        qs = Programme.objects.filter(date_programme=date_prog, is_deleted=False)
        if options["livreur"]:
            qs = qs.filter(utilisateur__code_livreur=options["livreur"])

        programmes = list(qs.select_related("utilisateur"))
        if not programmes:
            self.stdout.write(self.style.WARNING(
                f"Aucun programme pour le {date_prog}."
            ))
            return

        for prog in programmes:
            classement = appliquer_ordre_optimise(prog)
            self.stdout.write(
                f"  {prog.numero_x3} : {len(classement)} étape(s) ordonnée(s)"
            )
            if options["verbose"]:
                for etape, ordre, distance in classement:
                    d = f"{distance:.0f} m" if distance is not None else "n/a"
                    self.stdout.write(
                        f"      {ordre}. {etape.plv.libelle} "
                        f"(depuis précédent : {d})"
                    )

        self.stdout.write(self.style.SUCCESS(
            f"\nCircuits calculés pour {len(programmes)} programme(s) du {date_prog}."
        ))
