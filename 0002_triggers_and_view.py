"""
Migration manuelle (RunSQL) pour les artefacts SQL que Django ne genere pas
automatiquement : la fonction et les triggers de mise a jour de last_modified,
et la vue de reconciliation prevu/realise.

A executer APRES la migration initiale generee par `makemigrations`.
Le numero de fichier devra etre ajuste (par exemple 0002_triggers_view.py)
en fonction des migrations Django generees.
"""
from django.db import migrations


SYNCABLE_TABLES = [
    "programme",
    "etape",
    "ligne_programme",
    "operation",
    "ligne_operation",
    "anomalie",
    "photo",
]


SQL_CREATE_FUNCTION = """
CREATE OR REPLACE FUNCTION set_last_modified()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_modified := (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT;
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

SQL_DROP_FUNCTION = "DROP FUNCTION IF EXISTS set_last_modified() CASCADE;"


def _trigger_sql(table: str) -> tuple[str, str]:
    create = f"""
    DROP TRIGGER IF EXISTS trg_{table}_last_modified ON {table};
    CREATE TRIGGER trg_{table}_last_modified
        BEFORE INSERT OR UPDATE ON {table}
        FOR EACH ROW EXECUTE FUNCTION set_last_modified();
    """
    drop = f"DROP TRIGGER IF EXISTS trg_{table}_last_modified ON {table};"
    return create, drop


SQL_CREATE_VIEW = """
CREATE OR REPLACE VIEW v_reconciliation_etape AS
SELECT
    e.id              AS id_etape,
    e.programme_id    AS id_programme,
    e.plv_id          AS id_plv,
    p.libelle         AS libelle_plv,
    c.raison_sociale  AS client,
    prod.id           AS id_produit,
    prod.libelle      AS produit,
    COALESCE(lp.quantite_prevue, 0) AS quantite_prevue,
    COALESCE(SUM(lo.quantite_realisee), 0) AS quantite_realisee,
    COALESCE(SUM(lo.quantite_realisee), 0) - COALESCE(lp.quantite_prevue, 0) AS ecart
FROM etape e
JOIN plv p           ON p.id = e.plv_id
JOIN client c        ON c.id = p.client_id
LEFT JOIN ligne_programme lp ON lp.etape_id = e.id AND lp.is_deleted = FALSE
LEFT JOIN produit prod        ON prod.id = lp.produit_id
LEFT JOIN operation op        ON op.etape_id = e.id AND op.is_deleted = FALSE
LEFT JOIN ligne_operation lo  ON lo.operation_id = op.id
                              AND lo.produit_id = lp.produit_id
                              AND lo.is_deleted = FALSE
WHERE e.is_deleted = FALSE
GROUP BY e.id, e.programme_id, e.plv_id, p.libelle, c.raison_sociale,
         prod.id, prod.libelle, lp.quantite_prevue;
"""

SQL_DROP_VIEW = "DROP VIEW IF EXISTS v_reconciliation_etape;"


class Migration(migrations.Migration):

    dependencies = [
        # A ajuster : numero de la migration initiale generee par makemigrations
        ("distribution", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=SQL_CREATE_FUNCTION, reverse_sql=SQL_DROP_FUNCTION),
        *[
            migrations.RunSQL(sql=create, reverse_sql=drop)
            for create, drop in (_trigger_sql(t) for t in SYNCABLE_TABLES)
        ],
        migrations.RunSQL(sql=SQL_CREATE_VIEW, reverse_sql=SQL_DROP_VIEW),
    ]
