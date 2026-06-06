"""
Recalcule l'ordre de visite suggere (plus proche voisin) pour les programmes
existants. Utile pour appliquer le circuit a des programmes deja generes
(avant l'ajout de cette fonctionnalite), ou pour rejouer le calcul apres
avoir corrige les coordonnees du depot.

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
    help = "Recalcule l'ordre de visite suggere (plus proche voisin)."

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str,
            help="Date des programmes (YYYY-MM-DD). Par defaut : aujourd'hui.")
        parser.add_argument("--livreur", type=str,
            help="Code livreur specifique. Par defaut : tous.")
        parser.add_argument("--verbose", action="store_true",
            help="Affiche le detail du circuit calcule (ordre + distances).")

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
                f"  {prog.numero_x3} : {len(classement)} etape(s) ordonnee(s)"
            )
            if options["verbose"]:
                for etape, ordre, distance in classement:
                    d = f"{distance:.0f} m" if distance is not None else "n/a"
                    self.stdout.write(
                        f"      {ordre}. {etape.plv.libelle} "
                        f"(depuis precedent : {d})"
                    )

        self.stdout.write(self.style.SUCCESS(
            f"\nCircuits calcules pour {len(programmes)} programme(s) du {date_prog}."
        ))
