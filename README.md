# POC SODIGAZ — Assistance à la distribution de gaz

Preuve de concept (mémoire L3 Génie Logiciel) d'une application **mobile + web,
offline-first**, d'assistance aux livreurs de gaz, intégrée en simulation à
Sage X3.

Le livreur charge son programme du jour (collecte ou restitution de bouteilles),
se rend sur chaque point de livraison (PLV), saisit les opérations (quantités,
paiement, signatures, photos), signale les anomalies et clôture sa tournée — le
tout en fonctionnant **sans connexion**, avec synchronisation différée. Un
superviseur suit l'activité en temps quasi réel depuis une interface web.

---

## Architecture

```
                 +---------------------------+
                 |   Mobile (livreur)        |
                 |   Expo / React Native     |
                 |   TypeScript              |
                 |   SQLite locale (offline) |
                 +------------+--------------+
                              |  sync pull / push (JWT)
                              v
   +--------------------------+--------------------------+
   |        Back-end Django + DRF + GeoDjango            |
   |        PostgreSQL + PostGIS (natif WSL)             |
   |                                                     |
   |  mock_x3   auth_api   sync_api   supervision        |
   +--------------------------+--------------------------+
                              ^
                              |  session web
                 +------------+--------------+
                 |  Supervision (web)        |
                 |  Django Templates +       |
                 |  Bootstrap 5 + Leaflet    |
                 +---------------------------+
```

- **Back-end** : Django 5 + Django REST Framework + GeoDjango, sur PostgreSQL
  + PostGIS installés nativement dans WSL2.
- **Mobile** : Expo SDK 54 + React Native + TypeScript, base locale
  **expo-sqlite** avec une couche de **synchronisation manuelle** (pull/push).
- **Supervision web** : Django Templates + Bootstrap 5 + carte Leaflet/OSM,
  rafraîchissement par polling.
- **Authentification** : JWT (djangorestframework-simplejwt), connexion par
  code livreur.

---

## Applications Django

| App            | Rôle                                                                 |
|----------------|----------------------------------------------------------------------|
| `accounts`     | Modèle `Utilisateur` personnalisé (code_livreur, rôle)               |
| `distribution` | Modèles métier (PLV, produits, programmes, étapes, opérations, etc.) |
| `mock_x3`      | Simulation de Sage X3 (génération des programmes du jour)            |
| `auth_api`     | Authentification JWT (login par code livreur, refresh, profil)      |
| `sync_api`     | Synchronisation offline-first (pull, push, upload photos, clôture)  |
| `supervision`  | Interface web superviseur (dashboard, programmes, opérations, etc.) |

Le dossier `mobile/` contient l'application Expo (monorepo).

---

## Prérequis

- **WSL2 + Ubuntu** (développement sous Windows ; tout le back-end tourne dans WSL)
- **Python 3.12** (via le PPA deadsnakes)
- **PostgreSQL + PostGIS** installés nativement dans WSL
- **GDAL / GEOS / PROJ** pour GeoDjango
- **Node.js 20** + **Expo CLI** pour le mobile
- Un **smartphone Android** avec l'application **Expo Go** (test du mobile)

### Installation des dépendances système (Ubuntu/WSL)

```bash
sudo apt update
sudo apt install gdal-bin libgdal-dev python3-dev \
                 postgresql postgis postgresql-contrib
```

Python 3.12 via deadsnakes si nécessaire :

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install python3.12 python3.12-venv python3.12-dev
```

---

## Installation et démarrage (back-end)

```bash
# 1. Environnement virtuel + dépendances
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Configuration (copier et adapter les variables d'environnement)
cp .env.example .env
#    -> renseigner SECRET_KEY, DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT

# 3. Base de données : créer la base et activer PostGIS
#    (à faire une seule fois, en tant qu'utilisateur postgres)
sudo -u postgres psql -c "CREATE DATABASE sodigaz;"
sudo -u postgres psql -d sodigaz -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# 4. Migrations
python manage.py makemigrations
python manage.py migrate

# 5. Superuser (accès à l'admin)
python manage.py createsuperuser

# 6. Données de démonstration
python manage.py seed_demo

# 7. Programmes du jour (simulation de l'export Sage X3)
python manage.py generer_programmes_du_jour

# 8. Calcul du circuit suggéré (ordre de visite par plus proche voisin)
python manage.py calculer_circuits

# 9. Lancer le serveur (écoute sur toutes les interfaces pour le mobile)
python manage.py runserver 0.0.0.0:8000
```

- Admin Django : http://localhost:8000/admin/
- Supervision web : http://localhost:8000/supervision/

---

## Configuration réseau WSL ↔ mobile

Le téléphone (réseau Wi-Fi) doit joindre le serveur Django et le bundler Expo
(Metro), qui tournent dans WSL. Comme l'IP de Windows change selon le réseau et
que l'IP de WSL change au redémarrage, on met en place une redirection de ports
Windows → WSL pour les ports **8000** (Django) et **8081** (Metro).

Deux scripts automatisent cette reconfiguration, à relancer à chaque changement
de réseau Wi-Fi :

- `reconfig-reseau.ps1` — à lancer dans **PowerShell en administrateur** (côté
  Windows) : crée les règles `netsh portproxy` et les règles de pare-feu.
- `reconfig-reseau.sh` — à lancer dans **WSL**, en lui passant l'IP Windows en
  argument : met à jour `REACT_NATIVE_PACKAGER_HOSTNAME` et `mobile/.env`.

Côté mobile, le fichier `mobile/.env` contient :

```
EXPO_PUBLIC_API_URL=http://<IP_WINDOWS>:8000
```

En développement, `ALLOWED_HOSTS=*` dans les settings Django.

---

## Lancement de l'application mobile

```bash
cd mobile
npx expo start --clear
```

Scanner le QR code avec **Expo Go** sur le téléphone (téléphone et PC sur le
même réseau Wi-Fi). Relancer avec `--clear` après tout changement de librairie
ou de schéma SQLite.

---

## Comptes de démonstration

Tous les comptes créés par `seed_demo` ont le mot de passe **`demo1234`**.

| Identifiant  | Code      | Rôle        | Nom              |
|--------------|-----------|-------------|------------------|
| `adama.l`    | LIV001    | Livreur     | Adama OUEDRAOGO  |
| `salif.l`    | LIV002    | Livreur     | Salif KABORE     |
| `aminata.s`  | —         | Superviseur | Aminata TRAORE   |

Le livreur se connecte sur le **mobile** avec son code (LIV001 / demo1234).
Le superviseur se connecte sur la **web** (aminata.s / demo1234).

---

## Fonctionnalités couvertes

- Authentification JWT par code livreur
- Synchronisation offline-first bidirectionnelle (pull / push), idempotente,
  filtrée par utilisateur
- Chargement du programme du jour et des étapes (PLV à visiter)
- Circuit suggéré par heuristique du plus proche voisin (champ `ordre_optimise`),
  recommandation visible mais non verrouillée ; bouton « Itinéraire » vers la
  navigation externe
- Saisie d'opération : quantités par article, paiement, signatures (livreur et
  client), photos
- Géolocalisation à valeur probante des opérations (position fraîche horodatée,
  précision qualifiée)
- Signalement d'anomalies (type, gravité, description, photo, GPS)
- Clôture de programme avec récapitulatif, remontée au superviseur
- Supervision web : tableau de bord (KPI + carte), programmes, opérations,
  anomalies, réconciliation prévu / réalisé, rafraîchissement quasi temps réel

---

## Points d'attention techniques

1. **Synchronisation `last_modified`** : ce champ est mis à jour par trigger
   PostgreSQL (sur INSERT et UPDATE), pas par Django. Côté Python il est
   `editable=False, default=0` — ne jamais le définir manuellement.

2. **UUID serveur vs mobile** : les modèles `Programme`, `Etape`,
   `LigneProgramme` ont un `default=uuid_lib.uuid4` (UUID généré côté serveur).
   Les modèles `Operation`, `LigneOperation`, `Anomalie`, `Photo` n'en ont pas :
   l'UUID est fourni par le mobile au moment du push (détection des erreurs de
   protocole).

3. **Ordre des migrations** : `0002_triggers_and_view.py` suppose que
   `makemigrations` a produit `0001_initial.py`. Si Django génère un autre
   numéro, ajuster la dépendance dans la classe `Migration`.

4. **Point de dépôt (circuit)** : les coordonnées du dépôt servant de point de
   départ au calcul du circuit sont définies dans `config/settings.py`
   (`DEPOT_SODIGAZ`). Les valeurs actuelles sont **provisoires** (à remplacer par
   les coordonnées réelles du dépôt SODIGAZ, puis relancer `calculer_circuits`).

5. **Résolution de conflits** : stratégie *last-write-wins*, adaptée au modèle
   « un livreur = une tournée » du POC.

---

## Limites assumées (périmètre POC)

- Le POC valide la **faisabilité technique**, pas l'utilisabilité terrain : il
  n'a pas été testé par des livreurs en conditions réelles.
- Pas de suite de tests automatisés à ce stade.
- L'optimisation de circuit est une heuristique gloutonne (plus proche voisin),
  non optimale ; un solveur de tournées (VRP) reste une perspective d'évolution.
- La précision GPS dépend du matériel grand public (typiquement 5 à 50 m).
- La carte embarquée côté mobile n'est pas implémentée (la cartographie est
  assurée côté supervision web) ; c'est une évolution possible.

---

## Dépôt

Code source : https://github.com/SILGA-90/sodigaz-poc-distribution
