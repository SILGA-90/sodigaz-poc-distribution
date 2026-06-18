"""
Supprime les enregistrements Photo dont le fichier binaire n'a jamais
ete uploade (fichier == 'placeholder.bin') et dont la date de saisie
depasse le seuil (defaut : 24 heures).

Utilisation :
    python manage.py nettoyer_photos_orphelines
    python manage.py nettoyer_photos_orphelines --heures 48
    python manage.py nettoyer_photos_orphelines --dry-run

En production, planifier en cron journalier (ex. 3h du matin) :
    0 3 * * * /chemin/venv/bin/python /chemin/manage.py nettoyer_photos_orphelines
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from distribution.models import Photo, PHOTO_PLACEHOLDER


class Command(BaseCommand):
    help = "Supprime les enregistrements Photo sans fichier uploade apres le delai indique."

    def add_arguments(self, parser):
        parser.add_argument(
            "--heures",
            type=int,
            default=24,
            help="Anciennete minimale en heures avant suppression (defaut : 24).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Affiche les enregistrements concernes sans les supprimer.",
        )

    def handle(self, *args, **options):
        heures = options["heures"]
        dry_run = options["dry_run"]
        seuil = timezone.now() - timedelta(hours=heures)

        orphelines = Photo.objects.filter(
            fichier=PHOTO_PLACEHOLDER,
            date_heure__lt=seuil,
            is_deleted=False,
        )

        count = orphelines.count()

        if count == 0:
            self.stdout.write(self.style.SUCCESS("Aucune photo orpheline a nettoyer."))
            return

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"[dry-run] {count} photo(s) orpheline(s) seraient supprimees "
                    f"(seuil : {heures}h) :"
                )
            )
            for ph in orphelines.select_related("operation__etape__programme", "anomalie__programme"):
                programme = (
                    ph.operation.etape.programme if ph.operation_id
                    else ph.anomalie.programme if ph.anomalie_id
                    else None
                )
                ref = programme.numero_x3 if programme else "?"
                self.stdout.write(f"  - {ph.uuid}  type={ph.type_photo}  programme={ref}  date={ph.date_heure:%Y-%m-%d %H:%M}")
            return

        # Suppression logique (soft delete) : is_deleted=True comme partout
        # dans la codebase. Le trigger PostgreSQL met a jour last_modified
        # automatiquement, ce qui permet au pull mobile de recevoir l'enregistrement
        # dans la liste "deleted" et de le retirer de son cache local.
        supprimees = orphelines.update(is_deleted=True)
        self.stdout.write(
            self.style.SUCCESS(
                f"{supprimees} photo(s) orpheline(s) marquee(s) supprimee(s) "
                f"(seuil : {heures}h, date : {timezone.now():%Y-%m-%d %H:%M})."
            )
        )
