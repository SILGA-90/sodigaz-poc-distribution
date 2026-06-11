/**
 * Schéma de la base SQLite locale (expo-sqlite).
 *
 * Ce module définit CREATE_TABLES_SQL : le DDL complet de la base
 * locale : et SCHEMA_VERSION, utilisé par database.ts pour les
 * migrations (PRAGMA user_version).
 *
 * SQLite stocke un entier de version dans le fichier
 * via PRAGMA user_version. À chaque ouverture, database.ts compare la
 * version stockée à SCHEMA_VERSION et applique les migrations manquantes
 * (blocs "if currentVersion < N"). Incrémenter SCHEMA_VERSION force un
 * bloc de migration à s'exécuter sur toutes les installations existantes.
 *
 * SQLite n'a pas de type natif
 * DATE, DATETIME ou BOOLEAN.
 * - Dates : stockées en TEXT au format ISO 8601 (YYYY-MM-DDTHH:mm:ssZ).
 *          Compatible avec JavaScript Date, triables lexicographiquement.
 * - Booléens : INTEGER 0/1. SQLite ne possède pas de type BOOLEAN,
 *          mais l'entier 0/1 est idiomatique et explicite.
 * - Timestamps last_modified : INTEGER (epoch millisecondes), cohérent
 *          avec le serveur Django et les curseurs de synchronisation.
 *
 * Les tables sont regroupées selon leur flux
 * de synchronisation, cohérent avec distribution/models.py :
 * 1. Référentiels (pull only) : client, plv, article
 * 2. Semi-synchronisées (pull) : programme, etape, ligne_programme
 * 3. Push (créées mobile) : operation, ligne_operation, anomalie, photo
 *
 * Stocke les métadonnées de synchronisation
 * (lastPulledAt, clotures_pending) sans structure rigide. Évite d'ajouter
 * des colonnes techniques dans les tables métier.
 */

export const SCHEMA_VERSION = 5;

export const CREATE_TABLES_SQL = `
-- Table de métadonnées de synchronisation (curseur pull, file de clôtures)
CREATE TABLE IF NOT EXISTS sync_meta (
  cle TEXT PRIMARY KEY,
  valeur TEXT
);

-- ===== 1. Référentiels (pull only : jamais créés sur le mobile) =====

CREATE TABLE IF NOT EXISTS client (
  id INTEGER PRIMARY KEY,
  code_x3 TEXT NOT NULL,
  raison_sociale TEXT NOT NULL,
  type_client TEXT,
  contact TEXT,
  telephone TEXT,
  actif INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plv (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  libelle TEXT NOT NULL,
  adresse TEXT,
  latitude REAL,
  longitude REAL,
  statut TEXT DEFAULT 'ACTIF'
);

CREATE TABLE IF NOT EXISTS article (
  id INTEGER PRIMARY KEY,
  code_x3 TEXT NOT NULL UNIQUE,
  libelle TEXT NOT NULL,
  type_emballage TEXT,
  prix_unitaire REAL DEFAULT 0,
  montant_consignation REAL DEFAULT 0,
  actif INTEGER DEFAULT 1
);

-- ===== 2. Tables semi-synchronisées (pull : créées serveur, lues mobile) =====

CREATE TABLE IF NOT EXISTS programme (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  numero_x3 TEXT,
  utilisateur_id INTEGER,
  vehicule_id INTEGER,
  date_programme TEXT,
  type_programme TEXT,
  statut TEXT,
  heure_debut TEXT,
  heure_fin TEXT,
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS etape (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  programme_id INTEGER NOT NULL,
  plv_id INTEGER NOT NULL,
  ordre_prevu INTEGER,
  ordre_optimise INTEGER,
  statut_visite TEXT DEFAULT 'A_VISITER',
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ligne_programme (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  etape_id INTEGER NOT NULL,
  produit_id INTEGER NOT NULL,
  quantite_prevue INTEGER DEFAULT 0,
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

-- ===== 3. Tables push (créées sur le mobile, remontées au serveur) =====

CREATE TABLE IF NOT EXISTS operation (
  uuid TEXT PRIMARY KEY,        -- généré par le mobile (Crypto.randomUUID())
  etape_uuid TEXT NOT NULL,     -- référence l'étape par UUID (pas par id interne)
  type_operation TEXT NOT NULL,
  sous_type TEXT,
  date_heure TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  mode_paiement TEXT,
  montant_total REAL DEFAULT 0,
  montant_encaisse REAL DEFAULT 0,
  est_encaissee INTEGER DEFAULT 0,
  gps_precision REAL,
  gps_horodatage TEXT,
  signature_livreur TEXT DEFAULT '',
  signature_client TEXT DEFAULT '',
  nom_signataire_client TEXT DEFAULT '',
  commentaire TEXT DEFAULT '',
  sync_status TEXT DEFAULT 'PENDING',   -- PENDING = en attente de push
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ligne_operation (
  uuid TEXT PRIMARY KEY,
  operation_uuid TEXT NOT NULL,
  produit_code_x3 TEXT NOT NULL,        -- clé métier (pas l'id interne Django)
  quantite_realisee INTEGER DEFAULT 0,
  quantite_collectee_vide INTEGER DEFAULT 0,
  quantite_consignee INTEGER DEFAULT 0,
  quantite_deconsignee INTEGER DEFAULT 0,
  montant_ligne REAL DEFAULT 0,
  sync_status TEXT DEFAULT 'PENDING',
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS anomalie (
  uuid TEXT PRIMARY KEY,
  programme_uuid TEXT NOT NULL,
  plv_id INTEGER,
  type_anomalie TEXT NOT NULL,
  gravite TEXT DEFAULT 'MOYENNE',
  description TEXT,
  statut TEXT DEFAULT 'OUVERTE',
  date_heure TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  sync_status TEXT DEFAULT 'PENDING',
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS photo (
  uuid TEXT PRIMARY KEY,
  operation_uuid TEXT,
  anomalie_uuid TEXT,
  local_uri TEXT NOT NULL,
  type_photo TEXT NOT NULL,
  date_heure TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  taille_octets INTEGER,
  sync_status TEXT DEFAULT 'PENDING',
  upload_status TEXT DEFAULT 'PENDING',
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

-- Index : accélèrent les requêtes courantes (liste d'étapes d'un programme, etc.)
CREATE INDEX IF NOT EXISTS idx_etape_programme    ON etape(programme_id);
CREATE INDEX IF NOT EXISTS idx_ligne_prog_etape   ON ligne_programme(etape_id);
CREATE INDEX IF NOT EXISTS idx_operation_etape    ON operation(etape_uuid);
CREATE INDEX IF NOT EXISTS idx_operation_sync     ON operation(sync_status);
CREATE INDEX IF NOT EXISTS idx_ligne_op_operation ON ligne_operation(operation_uuid);
CREATE INDEX IF NOT EXISTS idx_anomalie_programme ON anomalie(programme_uuid);
CREATE INDEX IF NOT EXISTS idx_photo_operation    ON photo(operation_uuid);
CREATE INDEX IF NOT EXISTS idx_photo_sync         ON photo(sync_status, upload_status);
`;
