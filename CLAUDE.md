# CLAUDE.md — POC SODIGAZ (distribution de gaz)

> Ce fichier donne le contexte du projet à Claude Code à chaque session.
> Il décrit l'architecture, les conventions et les décisions ARRÊTÉES.
> Les bugs à traiter sont communiqués au fil de l'eau pendant la session.

## 1. Nature du projet

POC (proof of concept) pour un mémoire de Licence 3 Génie Logiciel (HETEC),
réalisé dans le cadre d'un projet professionnel chez SODIGAZ APC, distributeur
de gaz à Ouagadougou (Burkina Faso). L'application assiste les livreurs de gaz
en tournée : géolocalisation des points de livraison, saisie des opérations de
collecte/restitution, signatures, photos, anomalies, clôture de programme, le
tout avec une **synchronisation offline-first** vers un back-end, et une
**supervision web** côté superviseur.

Objet d'étude central et différenciant : l'**architecture offline-first et la
synchronisation différée bidirectionnelle**. C'est le cœur technique ; tout le
reste s'y rattache.

C'est un POC : il démontre une faisabilité technique. Il n'est PAS validé en
conditions réelles. Ne jamais inventer de chiffres de performance ni de retours
utilisateurs.

## 2. Stack technique

**Back-end** (`~/sodigaz_poc/`)
- Django 5 + Django REST Framework
- GeoDjango / PostGIS (données géospatiales : PointField)
- PostgreSQL **natif dans WSL** (PAS Docker), base `sodigaz`, extension postgis
- Auth : JWT via djangorestframework-simplejwt (login par code_livreur)
- Python 3.12 (venv à la racine)

**Mobile** (`~/sodigaz_poc/mobile/`)
- Expo SDK 54 + React Native + **TypeScript**
- Persistance locale : **expo-sqlite** avec couche de synchronisation **écrite
  à la main** (PAS WatermelonDB — voir décisions)
- Test via Expo Go (QR code)

**Supervision web** : Django Templates + Bootstrap 5 + Leaflet/OpenStreetMap
(carte, KPI, réconciliation prévu/réalisé, rafraîchissement par polling 15s).

**Dépôt** : GitHub privé, monorepo (mobile/ inclus dans sodigaz_poc).

## 3. Arborescence back-end

Apps Django :
- `accounts`    : modèle Utilisateur custom (code_livreur, role ; db_table "utilisateur")
- `distribution`: modèle métier principal (programmes, étapes, opérations…) + circuit.py
- `mock_x3`     : simulation de Sage X3 (génère les programmes du jour) + commandes
- `auth_api`    : endpoints d'authentification JWT
- `sync_api`    : endpoints de synchronisation pull/push
- `supervision` : interface web superviseur (login session Django)
- `config/`     : settings, urls, wsgi

Commandes de gestion utiles (mock_x3/management/commands/) :
- `generer_programmes_du_jour` (options : --reset / --date / --livreur)
- `seed_demo`        (jeu de données démo)
- `calculer_circuits` (--date / --livreur / --verbose ; heuristique plus proche voisin)

Endpoints principaux :
- `/api/auth/login/`, `/api/auth/refresh/`, `/api/auth/me/`
- `/api/mock-x3/programmes/`
- `/api/sync/pull/`  et  `/api/sync/push/`
- `/api/sync/photos/<uuid>/upload/`
- `/api/sync/programmes/cloturer/`
- `/supervision/` (dashboard, programmes, programme_detail, operations, anomalies)

## 4. Modèle de données (résumé)

Référentiels (descendants, lecture seule côté mobile, pull only) :
- Vehicule, Client (code_x3 -> BPCUSTOMER), Plv (localisation = PointField),
  Produit (code_x3 -> ITMMASTER, type_emballage B6/B12_5/B38/VRAC, montant_consignation)

Données de planification (descendantes, pull) :
- Programme (uuid, numero_x3, type_programme COLLECTE/RESTITUTION,
  statut PLANIFIE/EN_COURS/CLOTURE)
- Etape (ordre_prevu, ordre_optimise, statut_visite A_VISITER/VISITEE/ECHEC)
- LigneProgramme (quantite_prevue = LE PRÉVU)

Données terrain (ascendantes, créées sur le mobile, push) :
- Operation (uuid mobile, type_operation, sous_type BCR/BCT, signatures,
  montants, mode_paiement, localisation_saisie = PointField,
  gps_precision + gps_horodatage)
- LigneOperation (quantite_realisee = LE RÉALISÉ)
- Anomalie
- Photo (XOR : rattachée soit à une operation, soit à une anomalie)

Champs de synchronisation présents sur les tables concernées :
- `uuid`          : identifiant unique
- `last_modified` : BIGINT en millisecondes, mis à jour par un TRIGGER PostgreSQL
                    (champ editable=False, default=0 — NE JAMAIS l'écrire à la main)
- `is_deleted`    : suppression logique (soft delete)

Vue SQL `v_reconciliation_etape`. Migration `0002_triggers_and_view.py`.

UUID : Programme / Etape / LigneProgramme ont default=uuid4 (générés serveur).
Operation / LigneOperation / Anomalie / Photo n'ont PAS de default : leur uuid
est fourni par le mobile au moment du push.

## 5. Décisions d'architecture ARRÊTÉES (ne pas remettre en cause sans raison)

- **Offline-first** : le mobile fonctionne sans réseau ; la synchronisation est
  opportuniste (déclenchable dès qu'il y a du réseau, après chaque étape, pas
  seulement au retour de tournée). Le protocole pull/push est incrémental et
  idempotent, donc rejouable sans risque de doublon.
- **expo-sqlite + sync manuelle**, PAS WatermelonDB : WatermelonDB impose un
  build natif incompatible avec Expo Go, et l'écriture manuelle de la couche de
  sync est précisément l'objet d'étude du mémoire. Le PROTOCOLE s'inspire de
  WatermelonDB (pull puis push, created/updated/deleted, lastPulledAt) mais le
  code est maîtrisé de bout en bout.
- **Ordre de synchronisation** : pull AVANT push (se mettre à jour avant de
  pousser). La clôture de programme passe par une file dédiée traitée en tête
  de cycle. syncAll() = pushClotures() -> pull() -> push().
- **Idempotence du push** : update_or_create par UUID côté serveur.
- **Résolution de conflits** : last-write-wins (justifié : une opération
  appartient à un seul livreur sur sa seule tournée ; pas d'édition concurrente).
- **Programmation par CIRCUIT**, heuristique du PLUS PROCHE VOISIN (nearest
  neighbor) depuis le dépôt. L'ordre optimisé est une recommandation VISIBLE
  mais NON verrouillée (le livreur reste libre sur le terrain).
- **Tracking GPS continu ABANDONNÉ** : l'avancement se déduit d'opérations
  géolocalisées et horodatées, pas d'un suivi de position en temps réel.
- **Carte embarquée sur mobile : NON** (react-native-maps risqué sur Expo Go).
  La navigation se fait en ouvrant Google Maps via Linking. Perspective
  d'évolution seulement — ne pas coder de carte dans le mobile.
- **Superviseur unique** côté web pour le POC.
- **Flux remontant vers X3 (création BCR/BL dans Sage X3) NON implémenté** à ce
  jour : le mock_x3 génère les programmes (descendant), les opérations remontent
  vers Django et sont visibles en supervision, mais aucun document X3 n'est créé
  en retour. À traiter comme perspective ou à simuler dans le mock — ne pas
  prétendre que c'est fait.

## 6. Environnement & réseau (WSL2)

- Windows 11 + WSL2 + Ubuntu ; PostgreSQL + PostGIS natifs ; Python 3.12 (PPA deadsnakes).
- Lancer le serveur : `python manage.py runserver 0.0.0.0:8000`
- En dev : `ALLOWED_HOSTS = *`
- Le mobile (Expo Go sur téléphone physique) doit joindre le PC via le réseau
  local. Cela nécessite du port forwarding Windows -> WSL sur les ports 8000
  (Django) et 8081 (Metro), via des règles `netsh portproxy` + pare-feu.
- `mobile/.env` contient `EXPO_PUBLIC_API_URL=http://<IP_WINDOWS>:8000`
- Variable `REACT_NATIVE_PACKAGER_HOSTNAME=<IP_WINDOWS>`
- Les IP Windows/WSL changent à chaque réseau Wi-Fi : reconfigurer à chaque
  changement de réseau (scripts reconfig-reseau.ps1 / .sh).

## 7. Données de démo (seed_demo)

- Mot de passe commun : `demo1234`
- Livreurs : LIV001 (adama.l), LIV002 (salif.l)
- Superviseur : aminata.s
- 5 PLV à Ouagadougou, 3 clients, 3 produits (B6, B12, B38)
- Centre de carte : [12.3650, -1.5236]

## 8. État d'avancement (début juin 2026)

- Back-end : opérationnel (auth, mock X3, sync pull/push, supervision, photos).
- Mobile : sprints validés jusqu'à 3.6 (login JWT, SQLite + repos, sync pull/push,
  saisie d'opération, signatures SVG, photos, géolocalisation à valeur probante,
  écran anomalie, clôture).
- En cours : finitions et corrections de bugs ; rédaction du mémoire en parallèle.

## 9. Conventions et attentes de travail

- Langue de travail : **français**.
- Honnêteté technique avant tout : signaler explicitement les risques, les
  limites et les meilleures options. Ne jamais masquer une incertitude.
- Ne jamais inventer de sources, de chiffres, de références : marquer
  explicitement ce qui est incertain.
- Code : privilégier des modifications ciblées et vérifiables. Faire une
  sauvegarde / s'appuyer sur git avant les changements lourds. Tester quand
  c'est possible.
- Ne pas réintroduire les éléments écartés en section 5 (WatermelonDB, carte
  mobile embarquée, tracking GPS continu).
- Attention particulière aux invariants de synchronisation : ne pas écrire
  `last_modified` à la main, respecter l'origine des uuid (serveur vs mobile),
  préserver l'idempotence du push et l'ordre pull-avant-push.

## 10. Bugs à traiter

(Communiqués au fil de l'eau pendant la session. Au besoin, les consigner ici
pour en garder la trace d'une session à l'autre.)
