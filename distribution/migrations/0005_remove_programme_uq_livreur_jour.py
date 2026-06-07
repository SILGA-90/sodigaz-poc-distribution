"""
Supprime la contrainte unique (utilisateur, date_programme, type_programme).

Un livreur peut avoir plusieurs programmes du même type dans la journée
(cas rare mais réel chez SODIGAZ). Le numéro X3, dont le format inclut
l'heure de création (PRG-COL-20260607-1502), suffit à garantir l'unicité.
"""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("distribution", "0004_programme_partial_unique"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="programme",
            name="uq_programme_livreur_jour",
        ),
    ]
