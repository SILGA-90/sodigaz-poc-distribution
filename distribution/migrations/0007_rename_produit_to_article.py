"""Renomme le modèle Produit en Article.

La table PostgreSQL `produit` est conservée (db_table explicite sur Article) :
aucun ALTER TABLE n'est émis, la migration est un no-op au niveau SQL.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("distribution", "0006_plv_add_code_plv"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="Produit",
            new_name="Article",
        ),
    ]
