#!/bin/bash
# =============================================================================
# Sprint 2.1 du mobile : stockage local SQLite (expo-sqlite)
#   - schema SQLite miroir du modele Django
#   - couche d'acces aux donnees (repository pattern)
#   - ecran de debug pour verifier l'initialisation
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint2_1.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : ce script doit etre execute depuis ~/sodigaz_poc"
    exit 1
fi

if [ ! -d "mobile" ]; then
    echo "ERREUR : le dossier mobile/ n'existe pas. Fais d'abord Sprint 1."
    exit 1
fi

cd mobile

# Charger NVM / Node 20
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null 2>&1 || true

# =============================================================================
echo ""
echo "=== Etape 1 : installation d'expo-sqlite ==="
npx expo install expo-sqlite

# =============================================================================
echo ""
echo "=== Etape 2 : creation des fichiers ==="

mkdir -p src/db src/db/repositories src/types

# -----------------------------------------------------------------------------
# src/types/models.ts - types des entites metier cote mobile
# -----------------------------------------------------------------------------
cat > src/types/models.ts << 'TSEOF'
/**
 * Types des entites metier cote mobile.
 *
 * Ces types refletent le modele Django, mais ne contiennent que ce dont
 * le mobile a besoin. Les ForeignKey sont representees par l'id serveur
 * (number) pour les referentiels, et par uuid pour les entites synchronisees.
 *
 * Convention : tous les champs de synchronisation (uuid, last_modified,
 * is_deleted) suivent le meme schema que cote serveur.
 */

export type TypeProgramme = 'COLLECTE' | 'RESTITUTION';
export type StatutProgramme = 'PLANIFIE' | 'EN_COURS' | 'CLOTURE';
export type StatutVisite = 'A_VISITER' | 'VISITEE' | 'ECHEC';
export type TypeOperation = 'COLLECTE' | 'RESTITUTION' | 'LIVRAISON_DIRECTE' | 'CONSIGNE';
export type SousTypeCollecte = 'BCR' | 'BCT' | null;
export type ModePaiement = 'ESPECES' | 'MOBILE_MONEY' | 'CHEQUE' | 'VIREMENT' | 'CREDIT' | null;
export type StatutAnomalie = 'OUVERTE' | 'EN_TRAITEMENT' | 'RESOLUE';
export type GraviteAnomalie = 'FAIBLE' | 'MOYENNE' | 'ELEVEE';

// ---- Referentiels (lecture seule, recus du serveur) ----

export interface Client {
  id: number;
  code_x3: string;
  raison_sociale: string;
  type_client: string;
  contact: string;
  telephone: string;
  actif: number; // SQLite n'a pas de booleen : 0 ou 1
}

export interface Plv {
  id: number;
  client_id: number;
  libelle: string;
  adresse: string;
  latitude: number;
  longitude: number;
  statut: string;
}

export interface Produit {
  id: number;
  code_x3: string;
  libelle: string;
  type_emballage: string;
  prix_unitaire: number;
  montant_consignation: number;
  actif: number;
}

// ---- Tables semi-synchronisees (pull) ----

export interface Programme {
  id: number;
  uuid: string;
  numero_x3: string;
  utilisateur_id: number;
  vehicule_id: number | null;
  date_programme: string; // ISO date 'YYYY-MM-DD'
  type_programme: TypeProgramme;
  statut: StatutProgramme;
  heure_debut: string | null;
  heure_fin: string | null;
  last_modified: number;
  is_deleted: number;
}

export interface Etape {
  id: number;
  uuid: string;
  programme_id: number;
  plv_id: number;
  ordre_prevu: number;
  ordre_optimise: number | null;
  statut_visite: StatutVisite;
  last_modified: number;
  is_deleted: number;
}

export interface LigneProgramme {
  id: number;
  uuid: string;
  etape_id: number;
  produit_id: number;
  quantite_prevue: number;
  last_modified: number;
  is_deleted: number;
}

// ---- Tables push (creees sur le mobile) ----

export interface Operation {
  uuid: string;            // cle primaire cote mobile (genere localement)
  etape_uuid: string;      // reference l'etape par uuid
  type_operation: TypeOperation;
  sous_type: SousTypeCollecte;
  date_heure: string;      // ISO datetime
  latitude: number | null;
  longitude: number | null;
  mode_paiement: ModePaiement;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: number;
  signature_livreur: string;
  signature_client: string;
  nom_signataire_client: string;
  commentaire: string;
  // Champs de synchro locale
  sync_status: 'PENDING' | 'SYNCED'; // PENDING = pas encore remonte au serveur
  last_modified: number;
  is_deleted: number;
}

export interface LigneOperation {
  uuid: string;
  operation_uuid: string;
  produit_code_x3: string;  // le mobile reference le produit par code_x3
  quantite_realisee: number;
  quantite_collectee_vide: number;
  quantite_consignee: number;
  quantite_deconsignee: number;
  montant_ligne: number;
  sync_status: 'PENDING' | 'SYNCED';
  last_modified: number;
  is_deleted: number;
}

export interface Anomalie {
  uuid: string;
  programme_uuid: string;
  plv_id: number | null;
  type_anomalie: string;
  gravite: GraviteAnomalie;
  description: string;
  statut: StatutAnomalie;
  date_heure: string;
  latitude: number | null;
  longitude: number | null;
  sync_status: 'PENDING' | 'SYNCED';
  last_modified: number;
  is_deleted: number;
}
TSEOF

# -----------------------------------------------------------------------------
# src/db/schema.ts - definition du schema SQLite (DDL)
# -----------------------------------------------------------------------------
cat > src/db/schema.ts << 'TSEOF'
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
TSEOF

# -----------------------------------------------------------------------------
# src/db/database.ts - ouverture et initialisation de la base
# -----------------------------------------------------------------------------
cat > src/db/database.ts << 'TSEOF'
/**
 * Gestion de la connexion a la base SQLite locale.
 *
 * On ouvre une connexion unique partagee (singleton) et on initialise
 * le schema au premier acces.
 */
import * as SQLite from 'expo-sqlite';

import { CREATE_TABLES_SQL, SCHEMA_VERSION } from './schema';

const DB_NAME = 'sodigaz.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Retourne la connexion SQLite, en l'ouvrant et l'initialisant au besoin.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // Activer les cles etrangeres et le mode WAL (meilleures perfs concurrentes)
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // Verifier la version du schema et initialiser si besoin
  const result = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version;',
  );
  const currentVersion = result?.user_version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    // Creation initiale des tables
    await db.execAsync(CREATE_TABLES_SQL);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    // Migrations futures : ajouter ici des blocs if (currentVersion < N)
  }

  dbInstance = db;
  return db;
}

/**
 * Reinitialise completement la base (utile pour le debug / tests).
 * ATTENTION : supprime toutes les donnees locales.
 */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  const tables = [
    'sync_meta', 'client', 'plv', 'produit',
    'programme', 'etape', 'ligne_programme',
    'operation', 'ligne_operation', 'anomalie',
  ];
  for (const table of tables) {
    await db.execAsync(`DROP TABLE IF EXISTS ${table};`);
  }
  await db.execAsync(CREATE_TABLES_SQL);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/**
 * Lecture / ecriture du timestamp de derniere synchronisation.
 */
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
TSEOF

# -----------------------------------------------------------------------------
# src/db/repositories/programmeRepository.ts
# -----------------------------------------------------------------------------
cat > src/db/repositories/programmeRepository.ts << 'TSEOF'
/**
 * Repository des programmes : acces en lecture aux programmes stockes localement.
 */
import { getDatabase } from '../database';
import { Programme, Etape, Plv } from '../../types/models';

export interface EtapeAvecPlv extends Etape {
  plv_libelle: string;
  client_raison_sociale: string;
  plv_latitude: number;
  plv_longitude: number;
}

/**
 * Retourne les programmes du jour donne (format 'YYYY-MM-DD').
 */
export async function getProgrammesDuJour(date: string): Promise<Programme[]> {
  const db = await getDatabase();
  return db.getAllAsync<Programme>(
    `SELECT * FROM programme
     WHERE date_programme = ? AND is_deleted = 0
     ORDER BY type_programme, numero_x3;`,
    [date],
  );
}

/**
 * Retourne toutes les etapes d'un programme, avec les infos du PLV joint.
 */
export async function getEtapesDuProgramme(
  programmeId: number,
): Promise<EtapeAvecPlv[]> {
  const db = await getDatabase();
  return db.getAllAsync<EtapeAvecPlv>(
    `SELECT
        e.*,
        p.libelle AS plv_libelle,
        p.latitude AS plv_latitude,
        p.longitude AS plv_longitude,
        c.raison_sociale AS client_raison_sociale
     FROM etape e
     JOIN plv p ON p.id = e.plv_id
     JOIN client c ON c.id = p.client_id
     WHERE e.programme_id = ? AND e.is_deleted = 0
     ORDER BY e.ordre_prevu;`,
    [programmeId],
  );
}

/**
 * Compte le nombre total de programmes en base (debug).
 */
export async function countProgrammes(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM programme WHERE is_deleted = 0;',
  );
  return row?.n ?? 0;
}
TSEOF

# -----------------------------------------------------------------------------
# src/db/repositories/debugRepository.ts - compteurs pour l'ecran de debug
# -----------------------------------------------------------------------------
cat > src/db/repositories/debugRepository.ts << 'TSEOF'
/**
 * Repository de debug : compte les lignes de chaque table.
 * Utile pour verifier visuellement l'etat de la base locale.
 */
import { getDatabase } from '../database';

export interface TableCounts {
  [table: string]: number;
}

const TABLES = [
  'client', 'plv', 'produit',
  'programme', 'etape', 'ligne_programme',
  'operation', 'ligne_operation', 'anomalie',
];

export async function getTableCounts(): Promise<TableCounts> {
  const db = await getDatabase();
  const counts: TableCounts = {};
  for (const table of TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table};`,
    );
    counts[table] = row?.n ?? 0;
  }
  return counts;
}
TSEOF

# -----------------------------------------------------------------------------
# src/screens/DebugScreen.tsx - ecran de verification de la base
# -----------------------------------------------------------------------------
cat > src/screens/DebugScreen.tsx << 'TSEOF'
/**
 * Ecran de debug (temporaire, Sprint 2.1).
 * Affiche le nombre de lignes par table SQLite locale.
 * Permet de verifier que la base s'initialise et se remplira a la sync.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { getDatabase, resetDatabase, getLastPulledAt } from '../db/database';
import { getTableCounts, TableCounts } from '../db/repositories/debugRepository';

export default function DebugScreen(): React.ReactElement {
  const [counts, setCounts] = useState<TableCounts | null>(null);
  const [lastPull, setLastPull] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await getDatabase(); // force l'init
      const c = await getTableCounts();
      const lp = await getLastPulledAt();
      setCounts(c);
      setLastPull(lp);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleReset(): Promise<void> {
    setLoading(true);
    try {
      await resetDatabase();
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Base de donnees locale (SQLite)</Text>

      {loading && <ActivityIndicator size="large" color="#0d6efd" />}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Erreur : {error}</Text>
        </View>
      )}

      {counts && !loading && (
        <>
          <View style={styles.successBox}>
            <Text style={styles.successText}>
              Base initialisee correctement.
            </Text>
          </View>

          <View style={styles.table}>
            {Object.entries(counts).map(([table, n]) => (
              <View key={table} style={styles.row}>
                <Text style={styles.tableName}>{table}</Text>
                <Text style={styles.tableCount}>{n}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.meta}>
            Derniere synchronisation : {lastPull === 0 ? 'jamais' : new Date(lastPull).toLocaleString('fr-FR')}
          </Text>
        </>
      )}

      <TouchableOpacity style={styles.button} onPress={refresh}>
        <Text style={styles.buttonText}>Rafraichir</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={handleReset}>
        <Text style={styles.buttonText}>Reinitialiser la base (debug)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 16, color: '#333' },
  errorBox: { backgroundColor: '#f8d7da', padding: 12, borderRadius: 8, marginBottom: 12 },
  errorText: { color: '#842029' },
  successBox: { backgroundColor: '#d1e7dd', padding: 12, borderRadius: 8, marginBottom: 12 },
  successText: { color: '#0f5132', fontWeight: '600' },
  table: { backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tableName: { fontSize: 14, color: '#333', fontFamily: 'monospace' },
  tableCount: { fontSize: 14, fontWeight: '700', color: '#0d6efd' },
  meta: { fontSize: 13, color: '#666', marginBottom: 16, fontStyle: 'italic' },
  button: {
    backgroundColor: '#0d6efd',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDanger: { backgroundColor: '#dc3545' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
TSEOF

# =============================================================================
echo ""
echo "=== Etape 3 : ajout de l'ecran Debug a la navigation ==="

# Ajout de Debug dans les types de navigation
python3 << 'PYEOF'
from pathlib import Path

nav_types = Path("src/types/navigation.ts")
content = nav_types.read_text()
if "Debug" not in content:
    content = content.replace(
        "  Dashboard: undefined;",
        "  Dashboard: undefined;\n  Debug: undefined;",
    )
    nav_types.write_text(content)
    print("  + Debug ajoute aux types de navigation")

# Ajout de l'ecran Debug dans RootNavigator
root_nav = Path("src/navigation/RootNavigator.tsx")
content = root_nav.read_text()
if "DebugScreen" not in content:
    content = content.replace(
        "import DashboardScreen from '../screens/DashboardScreen';",
        "import DashboardScreen from '../screens/DashboardScreen';\n"
        "import DebugScreen from '../screens/DebugScreen';",
    )
    content = content.replace(
        '<Stack.Screen name="Dashboard" component={DashboardScreen} />',
        '<Stack.Screen name="Dashboard" component={DashboardScreen} />\n'
        '        <Stack.Screen name="Debug" component={DebugScreen} options={{ headerShown: true, title: "Debug BDD" }} />',
    )
    root_nav.write_text(content)
    print("  + Ecran Debug ajoute au RootNavigator")
PYEOF

# Ajout d'un bouton vers Debug dans le DashboardScreen
python3 << 'PYEOF'
from pathlib import Path

dash = Path("src/screens/DashboardScreen.tsx")
content = dash.read_text()

if "navigation.navigate('Debug')" not in content:
    # Ajouter un bouton avant le bouton de deconnexion
    content = content.replace(
        "      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>",
        "      <TouchableOpacity\n"
        "        style={styles.debugButton}\n"
        "        onPress={() => navigation.navigate('Debug')}\n"
        "      >\n"
        "        <Text style={styles.debugText}>Inspecter la base locale (debug)</Text>\n"
        "      </TouchableOpacity>\n\n"
        "      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>",
    )
    # Ajouter les styles correspondants
    content = content.replace(
        "  logoutButton: {",
        "  debugButton: {\n"
        "    marginHorizontal: 16,\n"
        "    marginBottom: 8,\n"
        "    padding: 14,\n"
        "    borderRadius: 8,\n"
        "    backgroundColor: '#6c757d',\n"
        "    alignItems: 'center',\n"
        "  },\n"
        "  debugText: { color: '#fff', fontWeight: '600' },\n"
        "  logoutButton: {",
    )
    dash.write_text(content)
    print("  + Bouton Debug ajoute au Dashboard")
PYEOF

cd ..

# =============================================================================
echo ""
echo "=============================================="
echo "SPRINT 2.1 - SETUP TERMINE."
echo "=============================================="
echo ""
echo "Relance le mobile :"
echo "  cd ~/sodigaz_poc/mobile"
echo "  npx expo start"
echo ""
echo "Sur le telephone (Expo Go), recharge l'app."
echo "Connecte-toi (LIV001 / demo1234), puis sur le Dashboard"
echo "clique sur 'Inspecter la base locale (debug)'."
echo ""
echo "Tu dois voir la liste des 9 tables, toutes a 0 ligne"
echo "(normal : la sync viendra au Sprint 2.2 les remplir)."
echo "L'essentiel : 'Base initialisee correctement.' s'affiche,"
echo "ce qui prouve que SQLite fonctionne sur ton telephone."
echo ""
