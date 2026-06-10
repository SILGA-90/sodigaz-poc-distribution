/**
 * Gestion de la connexion a la base SQLite locale.
 */
import * as SQLite from 'expo-sqlite';

import { CREATE_TABLES_SQL, SCHEMA_VERSION } from './schema';

const DB_NAME = 'sodigaz.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;
// Verrou d'initialisation : tous les appelants simultanés attendent la même
// promesse au lieu d'ouvrir chacun une connexion concurrente (race condition
// → NullPointerException côté natif Android sur prepareAsync).
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function _openAndInit(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = result?.user_version ?? 0;

  if (currentVersion < 1) {
    await db.execAsync(CREATE_TABLES_SQL);
    await db.execAsync('PRAGMA user_version = 1;');
  }

  // Migration v1 -> v2 : ajout de la table photo
  if (currentVersion < 2) {
    await db.execAsync(`
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
      CREATE INDEX IF NOT EXISTS idx_photo_operation ON photo(operation_uuid);
      CREATE INDEX IF NOT EXISTS idx_photo_sync ON photo(sync_status, upload_status);
    `);
    await db.execAsync('PRAGMA user_version = 2;');
  }

  // Migration v2 -> v3 : alignement de la version (toutes les tables sont déjà
  // créées par le bloc < 1 ; ce bloc existe uniquement pour synchroniser
  // user_version avec SCHEMA_VERSION sur les bases existantes à v2).
  if (currentVersion < 3) {
    await db.execAsync('PRAGMA user_version = 3;');
  }

  // Migration v3 -> v4 : contrainte UNIQUE sur produit.code_x3 (table encore nommée produit).
  // Sans cette contrainte, un reset des données serveur (nouveaux IDs)
  // créait des doublons via INSERT OR REPLACE (conflit sur id, pas code_x3).
  if (currentVersion < 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS produit_v4 (
        id INTEGER PRIMARY KEY,
        code_x3 TEXT NOT NULL UNIQUE,
        libelle TEXT NOT NULL,
        type_emballage TEXT,
        prix_unitaire REAL DEFAULT 0,
        montant_consignation REAL DEFAULT 0,
        actif INTEGER DEFAULT 1
      );
      INSERT OR IGNORE INTO produit_v4 (id, code_x3, libelle, type_emballage, prix_unitaire, montant_consignation, actif)
        SELECT id, code_x3, libelle, type_emballage, prix_unitaire, montant_consignation, actif
        FROM produit
        WHERE id IN (SELECT MAX(id) FROM produit GROUP BY code_x3);
      DROP TABLE produit;
      ALTER TABLE produit_v4 RENAME TO produit;
      PRAGMA user_version = 4;
    `);
  }

  // Migration v4 -> v5 : renommage de la table produit en article.
  if (currentVersion < 5) {
    await db.execAsync(`
      ALTER TABLE produit RENAME TO article;
      PRAGMA user_version = 5;
    `);
  }

  return db;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;

  if (!dbInitPromise) {
    dbInitPromise = _openAndInit()
      .then((db) => {
        dbInstance = db;
        dbInitPromise = null;
        return db;
      })
      .catch((err) => {
        dbInitPromise = null;
        throw err;
      });
  }

  return dbInitPromise;
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  const tables = [
    'sync_meta', 'client', 'plv', 'article',
    'programme', 'etape', 'ligne_programme',
    'operation', 'ligne_operation', 'anomalie', 'photo',
  ];
  for (const table of tables) {
    await db.execAsync(`DROP TABLE IF EXISTS ${table};`);
  }
  await db.execAsync('PRAGMA user_version = 0;');
  dbInstance = null;
  dbInitPromise = null;
  await getDatabase();
}

// --- Timestamp de derniere synchronisation ---

export async function getLastPulledAt(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ valeur: string }>(
    'SELECT valeur FROM sync_meta WHERE cle = ?;',
    ['last_pulled_at'],
  );
  return row ? parseInt(row.valeur, 10) : 0;
}

export async function setLastPulledAt(timestamp: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (cle, valeur) VALUES (?, ?);',
    ['last_pulled_at', String(timestamp)],
  );
}

// --- File d'attente des clotures (stockee dans sync_meta) ---
// On stocke les UUID des programmes clotures localement mais pas encore
// remontes au serveur. Cette liste survit aux pulls (contrairement a un
// champ dans la table programme, qui serait ecrase par INSERT OR REPLACE).

const CLE_CLOTURES = 'clotures_pending';

export async function getCloturesPending(): Promise<string[]> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ valeur: string }>(
    'SELECT valeur FROM sync_meta WHERE cle = ?;',
    [CLE_CLOTURES],
  );
  if (!row) return [];
  try {
    return JSON.parse(row.valeur) as string[];
  } catch {
    return [];
  }
}

export async function addCloturePending(uuid: string): Promise<void> {
  const db = await getDatabase();
  const current = await getCloturesPending();
  if (!current.includes(uuid)) {
    current.push(uuid);
  }
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (cle, valeur) VALUES (?, ?);',
    [CLE_CLOTURES, JSON.stringify(current)],
  );
}

export async function clearCloturesPending(uuids: string[]): Promise<void> {
  const db = await getDatabase();
  const current = await getCloturesPending();
  const restant = current.filter((u) => !uuids.includes(u));
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (cle, valeur) VALUES (?, ?);',
    [CLE_CLOTURES, JSON.stringify(restant)],
  );
}
