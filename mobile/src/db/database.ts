/**
 * Gestion de la connexion à la base SQLite locale (expo-sqlite).
 *
 * Ce module centralise l'ouverture, l'initialisation et les migrations
 * de la base de données SQLite embarquée dans l'application mobile.
 * Il expose :
 *          - getDatabase()       : point d'entrée unique pour obtenir l'instance DB
 *          - resetDatabase()     : réinitialisation complète (debug uniquement)
 *          - getLastPulledAt / setLastPulledAt : curseur de synchronisation
 *          - getCloturesPending / addCloturePending / clearCloturesPending :
 *            file d'attente des programmes clôturés hors-ligne
 *
 * expo-sqlite peut être appelé de
 * plusieurs endroits en parallèle au démarrage (composants qui montent
 * simultanément). Sans verrou, chaque appelant ouvrirait sa propre
 * connexion concurrente, ce qui provoque un NullPointerException natif
 * Android dans prepareAsync. Le verrou sérialise les appels : un seul
 * _openAndInit() s'exécute, tous les autres awaittent la même promesse.
 */
import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from './schema';

const DB_NAME = 'sodigaz.db';

/** Instance singleton de la base ouverte. null = pas encore initialisée. */
let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Verrou d'initialisation : promesse partagée par tous les appelants concurrents.
 * Voir en-tête du module. Ne jamais supprimer ce mécanisme.
 */
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Ouvre la base SQLite, applique les pragmas nécessaires et exécute
 * les migrations de schéma si la version locale est inférieure à
 * SCHEMA_VERSION.
 *
 * Le mode WAL améliore les performances en
 * écriture et permet des lectures concurrentes pendant une écriture.
 * Sur Android, le mode par défaut (DELETE journal) peut provoquer des
 * corruptions lors d'un crash en écriture.
 *
 * SQLite désactive les contraintes FK par défaut
 * pour des raisons de compatibilité ascendante. On les active
 * explicitement pour garantir l'intégrité référentielle du schéma.
 *
 * Chaque bloc `if (currentVersion < N)`
 * est idempotent et s'applique dans l'ordre croissant. Une base qui saute
 * plusieurs versions (ex. v1 -> v5 directement) passera par tous les blocs
 * intermédiaires. On ne peut jamais "sauter" une migration.
 */
async function _openAndInit(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // Mode WAL : meilleures performances et résistance aux crashs.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  // Contraintes FK : intégrité référentielle (désactivée par défaut dans SQLite).
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = result?.user_version ?? 0;

  // Migration v0 -> v1 : création initiale de toutes les tables du schéma.
  if (currentVersion < 1) {
    await db.execAsync(CREATE_TABLES_SQL);
    await db.execAsync('PRAGMA user_version = 1;');
  }

  // Migration v1 -> v2 : ajout de la table photo.
  // WHY : La gestion des photos a été ajoutée après la v1 initiale.
  //       On crée la table et les index associés.
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

  // Migration v2 -> v3 : alignement de user_version sur SCHEMA_VERSION.
  // WHY : Les tables étaient déjà créées par le bloc < 1 sur les bases existantes.
  //       Ce bloc existe uniquement pour synchroniser le numéro de version
  //       sur les installations qui étaient en v2 sans avoir besoin de DDL.
  if (currentVersion < 3) {
    await db.execAsync('PRAGMA user_version = 3;');
  }

  // Migration v3 -> v4 : ajout d'une contrainte UNIQUE sur produit.code_x3.
  // WHY : Sans contrainte UNIQUE sur code_x3, un reset des données serveur
  //       (nouveaux IDs après seed) créait des doublons via INSERT OR REPLACE
  //       (le conflit se faisait sur `id`, pas sur `code_x3`, laissant des
  //       lignes orphelines). On recrée la table avec la contrainte.
  // NOTE : Sur une installation fraîche (APK), CREATE_TABLES_SQL crée déjà
  //        `article` (pas `produit`), donc cette migration est un no-op dans ce cas.
  if (currentVersion < 4) {
    const hasProduit4 = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='produit';",
    );
    if (hasProduit4) {
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
      `);
    }
    await db.execAsync('PRAGMA user_version = 4;');
  }

  // Migration v4 -> v5 : renommage de la table `produit` en `article`.
  // WHY : Alignement terminologique avec le métier SODIGAZ (on parle d'articles,
  //       pas de produits). La colonne FK `produit_id` dans ligne_programme et
  //       ligne_operation conserve son nom (renommer nécessiterait de recréer
  //       ces tables ; le gain est cosmétique). Côté Django, db_table="produit"
  //       est conservé -> pas de migration SQL serveur nécessaire.
  // NOTE : Sur une installation fraîche, `produit` n'existe pas (déjà `article`)
  //        → on passe directement à PRAGMA user_version = 5.
  if (currentVersion < 5) {
    const hasProduit5 = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='produit';",
    );
    if (hasProduit5) {
      await db.execAsync('ALTER TABLE produit RENAME TO article;');
    }
    await db.execAsync('PRAGMA user_version = 5;');
  }

  // Migration v5 -> v6 : ajout de la colonne code_plv dans la table plv.
  // WHY : La colonne code_plv existe côté serveur (Django) et est envoyée par
  //       le pull, mais elle était absente du schéma mobile. ALTER TABLE ajoute
  //       la colonne sur les bases existantes (valeur NULL par défaut).
  //       On remet last_pulled_at à 0 pour forcer un pull complet au prochain
  //       sync et peupler code_plv sur tous les PLV déjà en base.
  // NOTE : Sur une installation fraîche, CREATE_TABLES_SQL crée déjà code_plv
  //        dans plv → on saute l'ALTER TABLE pour éviter "duplicate column".
  if (currentVersion < 6) {
    const hasCodePlv = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM pragma_table_info('plv') WHERE name='code_plv';",
    );
    if (!hasCodePlv || hasCodePlv.count === 0) {
      await db.execAsync('ALTER TABLE plv ADD COLUMN code_plv TEXT;');
      await db.runAsync(
        'INSERT OR REPLACE INTO sync_meta (cle, valeur) VALUES (?, ?);',
        ['last_pulled_at', '0'],
      );
    }
    await db.execAsync('PRAGMA user_version = 6;');
  }

  return db;
}

/**
 * Point d'entrée unique pour obtenir l'instance SQLite initialisée.
 * Garantit qu'une seule instance est créée, même en cas d'appels
 * concurrents au démarrage.
 *
 * *   - Si dbInstance est déjà défini, on retourne immédiatement (fast path).
 *   - Sinon, si dbInitPromise est null, on lance _openAndInit() et on stocke
 *     la promesse. Les appelants suivants awaittent la même promesse.
 *   - Une fois _openAndInit() terminé, dbInstance est défini et dbInitPromise
 *     remis à null pour libérer la mémoire.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;

  if (!dbInitPromise) {
    dbInitPromise = _openAndInit()
      .then((db) => {
        dbInstance    = db;
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

/**
 * Supprime toutes les tables, remet user_version à 0 et recrée le
 * schéma propre via getDatabase().
 *
 * Réservé à l'écran Debug BDD (accessible par 7 taps + PIN serveur).
 * Permet de tester un premier pull depuis zéro sans désinstaller l'app.
 * NE JAMAIS appeler en production : toutes les données PENDING non
 * synchronisées seront perdues définitivement.
 */
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
  // On invalide l'instance pour forcer une réinitialisation complète.
  dbInstance    = null;
  dbInitPromise = null;
  await getDatabase();
}

// ---------------------------------------------------------------------------
// Curseur de synchronisation (lastPulledAt)
// ---------------------------------------------------------------------------
// WHAT : lastPulledAt est un timestamp en millisecondes stocké dans sync_meta.
//        Il représente le `timestamp` retourné par le dernier pull réussi.
// WHY  : Permet les pulls incrémentaux (delta). Le serveur ne renvoie que les
//        enregistrements dont last_modified > lastPulledAt. Valeur 0 = premier pull.

export async function getLastPulledAt(): Promise<number> {
  const db  = await getDatabase();
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

// ---------------------------------------------------------------------------
// File d'attente des clôtures (clotures_pending dans sync_meta)
// ---------------------------------------------------------------------------
// WHAT : Stocke les UUIDs des programmes que le livreur a clôturés localement
//        mais qui n'ont pas encore été confirmés côté serveur.
//
// WHY (sync_meta plutôt que colonne dans `programme`) : Un INSERT OR REPLACE
//        sur la table `programme` (lors du pull) écraserait le statut CLOTURE
//        local avec EN_COURS (version serveur). En stockant la file dans une
//        table clé/valeur séparée, elle survit aux mises à jour des tables
//        métier. Elle est vidée uniquement sur confirmation du serveur (200 OK).

const CLE_CLOTURES = 'clotures_pending';

export async function getCloturesPending(): Promise<string[]> {
  const db  = await getDatabase();
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

/** WHAT : Ajoute un UUID à la file (idempotent : pas de doublon). */
export async function addCloturePending(uuid: string): Promise<void> {
  const db      = await getDatabase();
  const current = await getCloturesPending();
  if (!current.includes(uuid)) {
    current.push(uuid);
  }
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (cle, valeur) VALUES (?, ?);',
    [CLE_CLOTURES, JSON.stringify(current)],
  );
}

/** WHAT : Retire les UUIDs confirmés par le serveur de la file d'attente. */
export async function clearCloturesPending(uuids: string[]): Promise<void> {
  const db      = await getDatabase();
  const current = await getCloturesPending();
  const restant = current.filter((u) => !uuids.includes(u));
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (cle, valeur) VALUES (?, ?);',
    [CLE_CLOTURES, JSON.stringify(restant)],
  );
}
