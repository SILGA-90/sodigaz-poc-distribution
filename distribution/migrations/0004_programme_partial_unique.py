"""
Rend les contraintes uniques du Programme partielles (is_deleted=False seulement).

Cela permet au --reset de soft-deleter un programme et d'en créer un nouveau
avec le même numéro sans violer la contrainte, tout en notifiant le mobile via
le mécanisme is_deleted du protocole de synchronisation.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("distribution", "0003_operation_gps_horodatage_operation_gps_precision"),
    ]

    operations = [
        # 1. Agrandir numero_x3 pour permettre les suffixes de soft-delete
        migrations.AlterField(
            model_name="programme",
            name="numero_x3",
            field=models.CharField(max_length=50, help_text="N de programme cote Sage X3"),
        ),
        # 2. Supprimer l'ancienne contrainte non-partielle
        migrations.RemoveConstraint(
            model_name="programme",
            name="uq_programme_livreur_jour",
        ),
        # 3. Ajouter contrainte partielle sur (utilisateur, date_programme, type_programme)
        migrations.AddConstraint(
            model_name="programme",
            constraint=models.UniqueConstraint(
                fields=["utilisateur", "date_programme", "type_programme"],
                name="uq_programme_livreur_jour",
                condition=models.Q(is_deleted=False),
            ),
        ),
        # 4. Ajouter contrainte partielle sur numero_x3 (remplace unique=True supprimé)
        migrations.AddConstraint(
            model_name="programme",
            constraint=models.UniqueConstraint(
                fields=["numero_x3"],
                name="uq_programme_numero_x3",
                condition=models.Q(is_deleted=False),
            ),
        ),
    ]
