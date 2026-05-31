/**
 * Schema de la base SQLite locale.
 *
 * Versionne via PRAGMA user_version pour gerer les migrations futures.
 * Chaque entite a sa table. On stocke aussi un timestamp de derniere sync
 * dans une table sync_meta.
 *
 * Note : SQLite n'a pas de type DATE/BOOLEAN natif. On stocke :
 *   - les dates en TEXT (format ISO)
 *   - les booleens en INTEGER (0/1)
 *   - les timestamps last_modified en INTEGER (epoch ms)
 */

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL = `
-- Table de metadonnees de synchronisation
CREATE TABLE IF NOT EXISTS sync_meta (
  cle TEXT PRIMARY KEY,
  valeur TEXT
);

-- ===== Referentiels (pull only) =====

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

CREATE TABLE IF NOT EXISTS produit (
  id INTEGER PRIMARY KEY,
  code_x3 TEXT NOT NULL,
  libelle TEXT NOT NULL,
  type_emballage TEXT,
  prix_unitaire REAL DEFAULT 0,
  montant_consignation REAL DEFAULT 0,
  actif INTEGER DEFAULT 1
);

-- ===== Tables semi-synchronisees (pull) =====

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

-- ===== Tables push (creees sur le mobile) =====

CREATE TABLE IF NOT EXISTS operation (
  uuid TEXT PRIMARY KEY,
  etape_uuid TEXT NOT NULL,
  type_operation TEXT NOT NULL,
  sous_type TEXT,
  date_heure TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  mode_paiement TEXT,
  montant_total REAL DEFAULT 0,
  montant_encaisse REAL DEFAULT 0,
  est_encaissee INTEGER DEFAULT 0,
  signature_livreur TEXT DEFAULT '',
  signature_client TEXT DEFAULT '',
  nom_signataire_client TEXT DEFAULT '',
  commentaire TEXT DEFAULT '',
  sync_status TEXT DEFAULT 'PENDING',
  last_modified INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ligne_operation (
  uuid TEXT PRIMARY KEY,
  operation_uuid TEXT NOT NULL,
  produit_code_x3 TEXT NOT NULL,
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

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_etape_programme ON etape(programme_id);
CREATE INDEX IF NOT EXISTS idx_ligne_prog_etape ON ligne_programme(etape_id);
CREATE INDEX IF NOT EXISTS idx_operation_etape ON operation(etape_uuid);
CREATE INDEX IF NOT EXISTS idx_operation_sync ON operation(sync_status);
CREATE INDEX IF NOT EXISTS idx_ligne_op_operation ON ligne_operation(operation_uuid);
CREATE INDEX IF NOT EXISTS idx_anomalie_programme ON anomalie(programme_uuid);
`;
