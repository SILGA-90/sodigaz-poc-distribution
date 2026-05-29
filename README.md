# POC SODIGAZ - Setup

## Prerequis

- Docker + Docker Compose
- Python 3.11 ou 3.12
- GDAL/GEOS/PROJ pour GeoDjango (en local hors Docker)

### Installation GDAL sur Ubuntu/Debian
```bash
sudo apt update
sudo apt install gdal-bin libgdal-dev python3-dev
```

## Demarrage

```bash
# 1. Copier le fichier d'environnement
cp .env.example .env

# 2. Lancer PostgreSQL + PostGIS
docker compose up -d

# 3. Creer l'environnement virtuel et installer les dependances
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 4. Migrations
python manage.py makemigrations
python manage.py migrate

# 5. Superuser pour l'admin
python manage.py createsuperuser

# 6. Lancer le serveur
python manage.py runserver
```

L'admin Django est accessible sur http://localhost:8000/admin/

## Structure

```
sodigaz_poc/
├── config/              # Configuration Django (settings, urls, wsgi)
├── accounts/            # Modele Utilisateur personnalise
├── distribution/        # Modeles metier (programmes, operations, etc.)
│   └── migrations/
│       └── 0002_triggers_and_view.py   # Triggers + vue reconciliation
├── docker-compose.yml   # PostgreSQL 16 + PostGIS
├── requirements.txt
└── manage.py
```

## Points d'attention

1. **Ordre des migrations** : le fichier `0002_triggers_and_view.py` part du
   principe que `makemigrations` a produit un `0001_initial.py`. Si Django
   genere un autre numero, ajuster la dependance dans la classe `Migration`.

2. **Trigger `last_modified`** : ce champ est mis a jour par trigger PG, pas
   par Django. Ne jamais le definir manuellement dans le code.

3. **uuid cote serveur vs cote mobile** : les modeles `Programme`, `Etape`,
   `LigneProgramme` ont un `default=uuid_lib.uuid4` (uuid genere serveur).
   Les modeles `Operation`, `LigneOperation`, `Anomalie`, `Photo` n'ont PAS
   de default : l'uuid sera fourni par le mobile au moment du push.
```
