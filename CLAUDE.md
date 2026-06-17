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
- **Cibles matérielles : téléphones Android ET tablettes Android** — la majorité
  des livreurs sortent en tournée avec une tablette. L'orientation est `"default"`
  (portrait + paysage). Tous les écrans doivent être utilisables dans les deux
  orientations. Utiliser `flex` partout, éviter les largeurs fixes en px.
- Dépendances natives clés installées (ne pas ré-installer) :
  `expo-location` (GPS), `expo-image-picker` + `expo-image-manipulator` (photos),
  `expo-secure-store` (tokens chiffrés), `expo-file-system` (binaires),
  `expo-crypto` (hashage), `@react-native-community/netinfo` (connectivité),
  `@react-native-picker/picker` (dropdowns natifs), `react-native-svg` (icônes),
  `react-native-webview` (signatures).
  **`expo-linear-gradient` NON installé** — simuler les dégradés par vues
  superposées ou fond solide navy ; ne pas l'ajouter sans accord explicite.

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

- `generer_programmes_du_jour` (--date / --livreur / --type COL|RES|LES2 / --reset)
- `seed_demo` (--reset pour repartir de zéro)
- `calculer_circuits` (--date / --livreur / --verbose ; heuristique plus proche voisin)

Endpoints API REST (JWT) :

- `POST /api/auth/login/` — authentification code_livreur + password → tokens JWT
- `POST /api/auth/refresh/` — rotation refresh token (BLACKLIST_AFTER_ROTATION)
- `GET  /api/auth/me/` — profil utilisateur connecté
- `POST /api/auth/dev-access/` — vérification PIN dev (throttle 3/h, JWT requis)
- `GET  /api/mock-x3/programmes/` — programmes générés par le mock X3
- `POST /api/sync/pull/` — delta serveur depuis lastPulledAt (throttle 60/h)
- `POST /api/sync/push/` — upload opérations/anomalies/photos (throttle 60/h)
- `POST /api/sync/photos/<uuid>/upload/` — upload fichier binaire photo (throttle 300/h)
- `POST /api/sync/programmes/cloturer/` — clôture liste de programmes (throttle 60/h)

Endpoints supervision web (session Django, décorateur `@superviseur_required`) :

- `GET  /supervision/` — dashboard (KPIs, carte Leaflet, anomalies récentes)
- `GET  /supervision/api/carte/` — AJAX : GeoJSON PLVs + statuts pour Leaflet
- `GET  /supervision/api/stats/` — AJAX : 4 KPIs (programmes, opérations, montant, taux)
- `GET  /supervision/api/activite/` — AJAX : courbe d'activité par heure
- `GET  /supervision/api/activite-recente/` — AJAX : 8 dernières opérations
- `GET  /supervision/api/bilan-articles/` — AJAX : bilan articles collecte/restitution
- `GET  /supervision/livreurs/` — tableau livreurs + KPIs individuels
- `GET  /supervision/programmes/` — liste programmes (filtres date/statut/livreur)
- `GET  /supervision/programmes/<id>/` — détail programme + timeline étapes
- `GET  /supervision/operations/` — liste opérations (filtres, pagination)
- `GET  /supervision/operations/export/` — export CSV des opérations filtrées
- `GET  /supervision/operations/<uuid>/` — détail opération (photos, signature)
- `GET  /supervision/anomalies/` — liste anomalies (filtres gravité/statut)
- `GET  /supervision/anomalies/<id>/` — détail anomalie
- `POST /supervision/anomalies/<id>/statut/` — AJAX : changer statut (OUVERTE→EN_TRAITEMENT→RESOLUE)
- `POST /supervision/anomalies/<id>/gravite/` — AJAX : changer gravité
- `GET  /supervision/statistiques/` — tendances multi-jours
- `GET  /supervision/rapport/` — rapport journalier imprimable
- `GET  /supervision/carte/` — cartographie plein écran

## 4. Modèle de données (résumé)

**Modèle Utilisateur** (`accounts.Utilisateur`, table `utilisateur`) :
Hérite de `AbstractUser`. Champs ajoutés : `code_livreur` (identifiant terrain,
utilisé comme username), `telephone`, `role` (LIVREUR / SUPERVISEUR / ADMIN).
Le rôle SUPERVISEUR donne accès à `/supervision/` via `@superviseur_required`.

**Référentiels** (descendants, lecture seule côté mobile, pull only) :

- `Vehicule` : immatriculation, type, capacite, actif
- `Client` (code_x3 → BPCUSTOMER) : type_client DEPOT/REVENDEUR/GROS_CLIENT/PARTICULIER
- `Plv` (localisation = PointField) : code_plv, client FK, statut ACTIF/INACTIF/SUSPENDU
- `Article` (code_x3 → ITMMASTER, anciennement appelé "Produit" — renommé en migration
  0007 ; **le modèle Django s'appelle `Article`**, la table SQL garde le nom `produit`) :
  type_emballage B6/B12_5/B38/VRAC, montant_consignation

**Données de planification** (descendantes, pull) :

- `Programme` : uuid, numero_x3, type_programme COLLECTE/RESTITUTION,
  statut PLANIFIE/EN_COURS/CLOTURE, date_programme, heure_fin (remplie à la clôture),
  vehicule FK
- `Etape` : ordre_prevu, ordre_optimise (calculé par circuit.py), statut_visite
  A_VISITER/VISITEE/ECHEC
- `LigneProgramme` : quantite_prevue = LE PRÉVU

**Données terrain** (ascendantes, créées sur le mobile, push) :

- `Operation` : uuid mobile, type_operation COLLECTE/RESTITUTION/LIVRAISON_DIRECTE/CONSIGNE,
  sous_type BCR/BCT (obligatoire si type=COLLECTE), signatures, montant_total,
  montant_encaisse, est_encaissee, mode_paiement, localisation_saisie (PointField),
  gps_precision, gps_horodatage
- `LigneOperation` : quantite_realisee = LE RÉALISÉ
- `Anomalie` : gravite FAIBLE/MOYENNE/ELEVEE, statut OUVERTE/EN_TRAITEMENT/RESOLUE
- `Photo` (XOR : rattachée soit à une operation, soit à une anomalie) :
  type_photo BORDEREAU/LIVRAISON/ETAT_PLV/ANOMALIE, fichier, taille_octets

**Champs de synchronisation** présents sur les tables concernées :

- `uuid`          : identifiant unique
- `last_modified` : BIGINT en millisecondes, mis à jour par un **TRIGGER PostgreSQL**
                    (migration 0002 — champ `editable=False`, `default=0` —
                    **NE JAMAIS l'écrire à la main**)
- `is_deleted`    : suppression logique (soft delete — jamais de DELETE physique)

Vue SQL `v_reconciliation_etape` : rapprochement prévu/réalisé par étape.
Créée dans migration `0002_triggers_and_view.py` (même migration que les triggers).

**UUID** : Programme / Etape / LigneProgramme ont `default=uuid4` (générés serveur).
Operation / LigneOperation / Anomalie / Photo n'ont PAS de default : leur uuid
est fourni par le mobile au moment du push.

**Schéma SQLite mobile** (`mobile/src/db/database.ts` + `schema.ts`) :
11 tables : sync_meta, client, plv, article, programme, etape, ligne_programme,
operation, ligne_operation, anomalie, photo. Pas de table vehicule sur mobile
(vehicule_id est un entier brut dans programme). Mode WAL activé, FK activées.
`sync_meta` stocke deux clés : `last_pulled_at` (curseur du pull incrémental)
et `clotures_pending` (JSON : UUIDs des programmes clôturés hors-ligne, file
traitée en tête du cycle de sync). Migrations v1→v6 dans `database.ts` :
v1 création initiale, v2 ajout photo, v3 alignement no-op, v4 UNIQUE sur
article.code_x3, v5 rename produit→article, v6 ajout code_plv sur plv.

**Hiérarchie des modèles Django** (`distribution/models.py`) :

- `TimestampedModel` (abstract) : `created_at` + `updated_at` auto — hérité par
  tous les modèles, y compris les référentiels non synchronisables.
- `SyncableModel(TimestampedModel)` (abstract) : ajoute `last_modified` (BIGINT ms,
  trigger) + `is_deleted` — hérité par Programme, Etape, LigneProgramme, Operation,
  LigneOperation, Anomalie, Photo. Ne pas ajouter `last_modified` sur un modèle
  qui n'hérite pas de `SyncableModel`.

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
- **Flux remontant vers X3 — simulé dans mock_x3** : après chaque push réussi,
  `_sync_x3()` dans `SyncEngine` appelle `mock_x3.x3_sync.creer_documents_x3()`.
  Cela crée des `DocumentX3` (modèle dans `mock_x3/models.py`) : BCR pour COLLECTE,
  BL pour RESTITUTION (référence le BCR du même PLV). L'appel est hors-transaction
  et non-bloquant : un échec de la simulation ne fait pas échouer le push mobile.
  Ce n'est PAS une vraie intégration Sage X3 — aucun appel API réel, aucun document
  dans X3. À mentionner comme simulation dans le mémoire, pas comme intégration.
- **Mode développeur (Debug BDD) — accès protégé** : l'écran Debug BDD est caché
  derrière un mécanisme 7 taps + PIN vérifié côté serveur (endpoint
  `/api/auth/dev-access/`). Le code est dans la variable d'environnement
  `DEV_ACCESS_CODE` (`.env`). **Ne jamais coder le PIN en dur dans le bundle JS**
  (il serait extractible). Comparaison constant-time (`hmac.compare_digest`),
  throttle 3 tentatives/heure par utilisateur JWT.
- **Seuil GPS "fiable" = 100 m** : `SEUIL_FIABLE_METRES` dans `locationService.ts`
  vaut 100 m (pas 50). La localisation réseau Android donne typiquement 70-100 m
  avant fix satellite ; ce seuil est une étiquette de classification, pas un cap
  de précision matérielle. Le fix satellite reste à 5-15 m.
- **Rate limiting sur les endpoints de synchronisation** : `SyncRateThrottle`
  (60 req/heure/livreur) s'applique à `/api/sync/pull/`, `/api/sync/push/` et
  `/api/sync/programmes/cloturer/`. `PhotoUploadThrottle` (300 req/heure/livreur)
  s'applique à `/api/sync/photos/<uuid>/upload/`. Ces seuils sont dimensionnés
  pour absorber l'usage intensif (1 sync/min, 20 livraisons × 3 photos × 5
  rejeux) sans bloquer un usage légitime. Même pattern que `DevAccessThrottle`
  (`UserRateThrottle` + `scope` dans `DEFAULT_THROTTLE_RATES`). Ne pas abaisser
  les seuils sans recalculer l'usage réel terrain.
- **Gestionnaire d'exceptions global JSON** : `config.exceptions.custom_exception_handler`
  est branché comme `EXCEPTION_HANDLER` dans `REST_FRAMEWORK`. Il délègue d'abord
  au handler DRF standard (400/401/403/429), puis intercepte toute exception non
  reconnue (500) pour retourner `{"status": "error", "detail": "..."}` en JSON au
  lieu d'une page HTML — le mobile peut parser et afficher un message propre. La
  stack trace va uniquement dans les logs serveur (`logger.exception`).
- **Modèle de sécurité du moteur de sync — isolation livreur garantie à chaque
  niveau** : `SyncEngine` (engine.py) applique des contrôles d'autorisation
  exhaustifs, au-delà du simple `IsAuthenticated` sur la vue :
  - **Pull** : `Programme.objects.filter(utilisateur=self.user)` — un livreur ne
    peut tirer que ses propres programmes, étapes, opérations et anomalies.
  - **Push opérations** : `_preload_autorises()` charge les UUIDs d'étapes du
    livreur en mémoire (une seule requête) ; chaque étape inconnue est ignorée ;
    chaque étape appartenant à un autre livreur retourne un `HTTP 403` explicite
    et est consignée dans les logs (`logger.warning`).
  - **Push lignes, anomalies, photos** : vérification de la chaîne de propriété
    (`operation__etape__programme__utilisateur` / `programme__utilisateur`) à
    chaque niveau — le 403 est retourné si le livreur n'est pas propriétaire.
  - **Suppressions logiques** : toutes les `update(is_deleted=True)` filtrent par
    `programme__utilisateur=self.user` — un livreur ne peut pas effacer les
    données d'un autre.
  - **Upload photo** : double filtre `Q` (opération OU anomalie) par utilisateur +
    validation temporelle (tolérance 2h entre la photo et l'opération associée).
  - **Clôture** : `Programme.objects.filter(uuid=u, utilisateur=request.user)` —
    un livreur ne peut clôturer que ses propres programmes.
  Ce niveau de contrôle démontre qu'une architecture offline-first n'implique pas
  un relâchement de la sécurité côté serveur — argument explicitable dans le mémoire.
- **Singleton d'initialisation SQLite** : `database.ts` utilise `dbInitPromise`
  pour sérialiser les appels concurrents à `openDatabaseAsync()`. Sans ça,
  plusieurs appelants simultanés créent plusieurs instances → NullPointerException
  Android (`prepareAsync`). Ne jamais supprimer ce verrou.
- **JWT — durées de vie** : Access token 60 min (durée d'une tournée), refresh
  30 jours. `ROTATE_REFRESH_TOKENS = True` + `BLACKLIST_AFTER_ROTATION = True` :
  à chaque refresh un nouveau refresh token est émis et l'ancien est blacklisté
  (anti-replay). Le client mobile (`client.ts`) gère la rotation transparente.
- **Rate limiting login** : `LoginRateThrottle` sur `POST /api/auth/login/` —
  5 tentatives/minute par IP (anti brute-force). Même pattern DRF `AnonRateThrottle`
  que les autres throttles.
- **Décorateur `@superviseur_required`** (`supervision/decorators.py`) : protège
  toutes les vues de supervision. Compose `@login_required` + vérification de rôle :
  laisse passer SUPERVISEUR, ADMIN et superuser ; rejette un livreur avec HTTP 403.
  Toute nouvelle vue supervision doit porter ce décorateur — pas seulement
  `@login_required`.
- **Navigation par date en supervision** : la date de consultation est persistée en
  session Django via `_get_date_filter()` (`supervision/views/_base.py`). Priorité :
  paramètre GET `?date=` > session `date_filter` > aujourd'hui. Cela synchronise la
  date entre dashboard, programmes, opérations et livreurs sans la resaisir.
  Les vues AJAX lisent la session sans l'écrire (`write_session=False`).
- **`CircuitOptimizer`** (`distribution/circuit.py`) : classe autonome, distance
  Haversine, point de départ = `DEPOT_SODIGAZ` (coordonnées provisoires dans
  `settings.py` — à remplacer par les vraies coordonnées en production). Calcule
  `Etape.ordre_optimise` ; `ordre_prevu` reste inchangé. Non bloquant : le livreur
  peut dévier librement.
- **Migration 0002 est critique** : crée le trigger PostgreSQL `update_last_modified`
  (qui maintient `last_modified` en ms à chaque UPDATE) ET la vue SQL
  `v_reconciliation_etape`. Sans cette migration, tout le protocole de sync est
  cassé. Ne jamais la squasher ni la supprimer.
- **Couleurs de marque (officielles, en l'absence de charte écrite — extraites du logo)**. La couleur primaire est le bleu Sodigaz #079BD9 ; l'accent / action principale est l'orange APC #EE7202 ; l'ambre de la flamme est #FAB848. Ces valeurs font autorité et remplacent le bleu Bootstrap générique #0d6efd ainsi que la valeur erronée #1a7fba présente dans d'anciens fichiers. La couleur doit vivre dans un token unique (thème mobile + surcharge --bs-primary côté web), jamais en dur dans les composants. Référence détaillée : skill design-sodigaz.

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
- Livreurs : LIV001 (adama.l), LIV002 (salif.l), LIV003 (moussa.l), LIV004 (awa.l), LIV005 (issouf.l)
- Superviseur : aminata.s
- 15 clients, 25 PLVs (codes PLVO101–PLVO125) à Ouagadougou
- 6 articles : 3 emballages vides E\* (E06BI, E1250, E3800) + 3 gaz plein G\* (G06BI, G1250, G3800)
- Centre de carte : [12.3650, -1.5236]
- Seed idempotent (get_or_create + update_or_create) ; `--reset` pour repartir de zéro

## 8. État d'avancement (juin 2026)

- **Back-end** : opérationnel (auth JWT, mock X3, sync pull/push, supervision web,
  photos, endpoint dev-access avec throttle). Ajouts récents :
  - Rate limiting sur tous les endpoints sync (60/h) et upload photo (300/h)
    via `SyncRateThrottle` / `PhotoUploadThrottle` (`sync_api/views.py`)
  - Gestionnaire d'exceptions global JSON (`config/exceptions.py`) —
    garantit que l'API renvoie toujours du JSON, même sur une erreur 500
  - Logs des 500 non gérés dans `logs/django.log` via `logger.exception()`
- **Mobile** : fonctionnel bout en bout. 10 écrans implémentés :
  `LoginScreen`, `DashboardScreen`, `ProgrammeScreen`, `EtapeDetailScreen`,
  `SaisieOperationScreen`, `AnomalieScreen`, `ClotureScreen`,
  `HistoriqueScreen`, `MesAnomaliesScreen`, `DebugScreen`.
  Corrections et ajouts :
  - Race condition SQLite (NullPointerException Android) → corrigée (`dbInitPromise`)
  - Seuil GPS ajusté à 100 m, timeout 45 s (`locationService.ts`)
  - Debug BDD protégé (7 taps + PIN serveur), bugs d'audit corrigés
  - Design cohérent : couleurs SODIGAZ, `theme.ts` créé, LoginScreen branded
  - Adaptation tablettes : layouts 2 colonnes (Dashboard, Programme, Historique,
    MesAnomalies), DashboardHeader compact en paysage, SignaturePad dynamique,
    SafeAreaProvider dans App.tsx
  - Hooks custom : `useLayout()` (détecte orientation + numColumns),
    `useNetworkStatus()` (connectivité temps réel + événement justReconnected)
  - Services : `locationService.ts` (GPS qualifié fiable/dégradé/absent),
    `photoService.ts` (compression + stockage local), `logger.ts`
- **Supervision web** : refonte design — Bootstrap primary overridé (ancienne valeur
  `#1a7fba`, à migrer vers `#079BD9` officiel), tables en cards (`table-card`),
  filtres stylés (`filter-card`), login page avec fond dégradé navy. Export CSV
  opérations (séparateur `;` pour compatibilité Excel français). Modification
  statut/gravité anomalies via AJAX sans rechargement de page.
- **Documentation** : README.md et .env.example mis à jour (DEV_ACCESS_CODE,
  précision GPS).
- En cours : rédaction du mémoire.

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
- **Couleurs de marque SODIGAZ officielles** (bleu `#079BD9`, orange `#EE7202`,
  ambre `#FAB848`, navy `#0a1628`). Ne pas revenir à Bootstrap `#0d6efd` ni à
  l'ancienne valeur `#1a7fba` encore présente dans certains fichiers CSS/style
  hérités — remplacer systématiquement. Référence complète : skill design-sodigaz.
- **`expo-linear-gradient` non installé** — simuler les dégradés avec des vues
  superposées ou un fond solide navy. Ne pas l'ajouter sans accord explicite.
- **Ne jamais coder le PIN dev en dur** dans le JS/TS mobile (toujours via
  `/api/auth/dev-access/` + `DEV_ACCESS_CODE` côté serveur).
- **Nommage modèle Article** : le modèle Django s'appelle `Article` (renommé de
  `Produit` en migration 0007). La table PostgreSQL garde le nom `produit`. Ne pas
  créer de code qui référence `Produit` — utiliser `Article` partout.
- **Supervision : toujours utiliser `@superviseur_required`** pour toute nouvelle
  vue web, pas seulement `@login_required`. Le décorateur vérifie en plus le rôle.

## 10. Bugs à traiter

Aucun bug connu en suspens au 17 juin 2026.
(Consigner ici au fil de l'eau les nouveaux bugs inter-sessions.)

## 11. Perspectives et limites connues (pour le mémoire)

- **Gestion des acomptes non couverte** : le modèle suppose un paiement unique au
  moment de la livraison (`montant_total` / `montant_encaisse` / `est_encaissee`).
  Si un client a déjà versé un acompte et règle le reliquat à la livraison,
  le rapport journalier afficherait un écart apparent (impayé partiel) alors que
  le client est soldé. Résoudre ce cas nécessiterait :
  1. Un champ `montant_acompte` sur l'opération (ou une table dédiée aux
     échéances de paiement).
  2. Une synchronisation descendante de l'historique de paiement depuis Sage X3
     vers le mobile (aujourd'hui seuls les programmes descendent, pas les
     encours clients).
  Ce périmètre dépasse le POC ; à mentionner comme perspective d'évolution.

- **Flux remontant vers X3 simulé, non réel** : `DocumentX3` (BCR/BL) est créé
  dans mock_x3 après chaque push, mais aucune API Sage X3 n'est appelée. La
  simulation suffit pour le POC ; en production, `_sync_x3()` devrait être remplacé
  par un vrai appel API X3 (ou queue de messages). À expliciter dans le mémoire.

- **SQL brut répété dans les repositories mobiles** : les repositories
  (`pull.ts`, `programmeRepository.ts`, `photoRepository.ts`…) contiennent des
  `INSERT OR REPLACE INTO` explicites par table, sans couche d'abstraction
  commune. Acceptable dans un POC (schéma figé, lisibilité des colonnes
  garantie), mais fragile si le schéma évolue. En version production, à
  remplacer par une couche ORM-like maison ou une bibliothèque dédiée
  (WatermelonDB avec build natif, ou abstraction `upsert(table, data)` légère).
  Ne pas abstraire maintenant : le schéma est stabilisé et le gain serait
  cosmétique avant la fin du mémoire.
