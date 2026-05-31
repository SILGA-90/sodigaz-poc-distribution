#!/bin/bash
# =============================================================================
# Sprint 2.2 du mobile : synchronisation PULL
#   - SyncService.pull() : appelle /api/sync/pull/, applique en transaction
#   - Dashboard : bouton "Synchroniser" + liste des programmes
#   - Ecran Programme : liste des etapes a visiter
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint2_2.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : execute depuis ~/sodigaz_poc"
    exit 1
fi

cd mobile

# =============================================================================
echo "=== Creation du service de synchronisation ==="

mkdir -p src/sync

# -----------------------------------------------------------------------------
# src/sync/syncService.ts
# -----------------------------------------------------------------------------
cat > src/sync/syncService.ts << 'TSEOF'
/**
 * Service de synchronisation.
 *
 * SPRINT 2.2 : implemente le PULL.
 *   - Appelle POST /api/sync/pull/ avec le timestamp de derniere sync
 *   - Applique les changements recus dans une transaction SQLite unique
 *   - Met a jour le timestamp pour le prochain pull incremental
 *
 * Le push sera ajoute au Sprint 2.3.
 *
 * Format de reponse du serveur (rappel) :
 *   {
 *     "changes": {
 *       "client":  { "created": [], "updated": [...], "deleted": [...] },
 *       "plv":     { ... },
 *       ...
 *     },
 *     "timestamp": 1717111200000
 *   }
 */
import apiClient from '../api/client';
import { getDatabase, getLastPulledAt, setLastPulledAt } from '../db/database';

interface TableChanges {
  created: any[];
  updated: any[];
  deleted: string[];
}

interface PullResponse {
  changes: Record<string, TableChanges>;
  timestamp: number;
}

export interface PullResult {
  success: boolean;
  timestamp: number;
  counts: Record<string, number>;
  error?: string;
}

/**
 * Convertit un booleen JSON (true/false) en entier SQLite (1/0).
 */
function bool(value: any): number {
  return value ? 1 : 0;
}

export async function pull(): Promise<PullResult> {
  const lastPulledAt = await getLastPulledAt();

  let response;
  try {
    response = await apiClient.post<PullResponse>('/api/sync/pull/', {
      lastPulledAt,
    });
  } catch (e: any) {
    return {
      success: false,
      timestamp: lastPulledAt,
      counts: {},
      error: e?.response?.data?.detail ?? e?.message ?? 'Erreur reseau',
    };
  }

  const { changes, timestamp } = response.data;
  const db = await getDatabase();
  const counts: Record<string, number> = {};

  try {
    await db.withTransactionAsync(async () => {
      // ----- Referentiels -----
      counts.client = await applyClients(db, changes.client);
      counts.plv = await applyPlvs(db, changes.plv);
      counts.produit = await applyProduits(db, changes.produit);

      // ----- Tables semi-synchronisees -----
      counts.programme = await applyProgrammes(db, changes.programme);
      counts.etape = await applyEtapes(db, changes.etape);
      counts.ligne_programme = await applyLignesProgramme(db, changes.ligne_programme);

      // NOTE : operation / ligne_operation / anomalie sont gerees au Sprint 2.3.
      // Au premier pull d'un livreur, elles sont vides cote serveur.
    });
  } catch (e: any) {
    return {
      success: false,
      timestamp: lastPulledAt,
      counts: {},
      error: 'Erreur lors de l\'application des donnees : ' + (e?.message ?? String(e)),
    };
  }

  // Mise a jour du timestamp seulement si tout a reussi
  await setLastPulledAt(timestamp);

  return { success: true, timestamp, counts };
}

// ---------------------------------------------------------------------------
// Application table par table (verbeux mais explicite et defendable)
// ---------------------------------------------------------------------------

async function applyClients(db: any, changes?: TableChanges): Promise<number> {
  if (!changes) return 0;
  const rows = [...changes.created, ...changes.updated];
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO client
       (id, code_x3, raison_sociale, type_client, contact, telephone, actif)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.code_x3, r.raison_sociale, r.type_client ?? '', r.contact ?? '', r.telephone ?? '', bool(r.actif)],
    );
  }
  return rows.length;
}

async function applyPlvs(db: any, changes?: TableChanges): Promise<number> {
  if (!changes) return 0;
  const rows = [...changes.created, ...changes.updated];
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO plv
       (id, client_id, libelle, adresse, latitude, longitude, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.client_id, r.libelle, r.adresse ?? '', r.latitude, r.longitude, r.statut ?? 'ACTIF'],
    );
  }
  return rows.length;
}

async function applyProduits(db: any, changes?: TableChanges): Promise<number> {
  if (!changes) return 0;
  const rows = [...changes.created, ...changes.updated];
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO produit
       (id, code_x3, libelle, type_emballage, prix_unitaire, montant_consignation, actif)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.code_x3, r.libelle, r.type_emballage ?? '', r.prix_unitaire ?? 0, r.montant_consignation ?? 0, bool(r.actif)],
    );
  }
  return rows.length;
}

async function applyProgrammes(db: any, changes?: TableChanges): Promise<number> {
  if (!changes) return 0;
  const rows = [...changes.created, ...changes.updated];
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO programme
       (id, uuid, numero_x3, utilisateur_id, vehicule_id, date_programme,
        type_programme, statut, heure_debut, heure_fin, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0);`,
      [r.id, r.uuid, r.numero_x3 ?? '', r.utilisateur_id, r.vehicule_id ?? null,
       r.date_programme, r.type_programme, r.statut,
       r.heure_debut ?? null, r.heure_fin ?? null, r.last_modified ?? 0],
    );
  }
  // Suppressions
  for (const uuid of changes.deleted ?? []) {
    await db.runAsync('DELETE FROM programme WHERE uuid = ?;', [uuid]);
  }
  return rows.length;
}

async function applyEtapes(db: any, changes?: TableChanges): Promise<number> {
  if (!changes) return 0;
  const rows = [...changes.created, ...changes.updated];
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO etape
       (id, uuid, programme_id, plv_id, ordre_prevu, ordre_optimise,
        statut_visite, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0);`,
      [r.id, r.uuid, r.programme_id, r.plv_id, r.ordre_prevu,
       r.ordre_optimise ?? null, r.statut_visite, r.last_modified ?? 0],
    );
  }
  for (const uuid of changes.deleted ?? []) {
    await db.runAsync('DELETE FROM etape WHERE uuid = ?;', [uuid]);
  }
  return rows.length;
}

async function applyLignesProgramme(db: any, changes?: TableChanges): Promise<number> {
  if (!changes) return 0;
  const rows = [...changes.created, ...changes.updated];
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO ligne_programme
       (id, uuid, etape_id, produit_id, quantite_prevue, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, 0);`,
      [r.id, r.uuid, r.etape_id, r.produit_id, r.quantite_prevue, r.last_modified ?? 0],
    );
  }
  for (const uuid of changes.deleted ?? []) {
    await db.runAsync('DELETE FROM ligne_programme WHERE uuid = ?;', [uuid]);
  }
  return rows.length;
}
TSEOF

echo "  + syncService.ts cree"

# -----------------------------------------------------------------------------
# Mise a jour du programmeRepository : ajouter getProgrammesRecents
# -----------------------------------------------------------------------------
cat > src/db/repositories/programmeRepository.ts << 'TSEOF'
/**
 * Repository des programmes : acces en lecture aux programmes locaux.
 */
import { getDatabase } from '../database';
import { Programme, Etape } from '../../types/models';

export interface EtapeAvecPlv extends Etape {
  plv_libelle: string;
  client_raison_sociale: string;
  plv_latitude: number;
  plv_longitude: number;
}

export interface ProgrammeAvecProgression extends Programme {
  total_etapes: number;
  etapes_visitees: number;
}

/**
 * Programmes des 7 derniers jours, avec leur progression (etapes visitees).
 * On ne filtre pas strictement sur "aujourd'hui" pour eviter qu'un programme
 * genere un autre jour n'apparaisse pas pendant le developpement.
 */
export async function getProgrammesRecents(): Promise<ProgrammeAvecProgression[]> {
  const db = await getDatabase();
  return db.getAllAsync<ProgrammeAvecProgression>(
    `SELECT
        pr.*,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0) AS total_etapes,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'VISITEE') AS etapes_visitees
     FROM programme pr
     WHERE pr.is_deleted = 0
       AND date(pr.date_programme) >= date('now', '-7 days')
     ORDER BY pr.date_programme DESC, pr.type_programme;`,
  );
}

export async function getProgrammeById(id: number): Promise<Programme | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Programme>(
    'SELECT * FROM programme WHERE id = ? AND is_deleted = 0;',
    [id],
  );
  return row ?? null;
}

export async function getEtapesDuProgramme(programmeId: number): Promise<EtapeAvecPlv[]> {
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
TSEOF

echo "  + programmeRepository.ts mis a jour"

# -----------------------------------------------------------------------------
# Reecriture du DashboardScreen avec sync + liste des programmes
# -----------------------------------------------------------------------------
cat > src/screens/DashboardScreen.tsx << 'TSEOF'
/**
 * Ecran d'accueil apres connexion.
 * Sprint 2.2 : bouton de synchronisation + liste des programmes recuperes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { fetchMe, logout } from '../api/authService';
import { pull } from '../sync/syncService';
import { getProgrammesRecents, ProgrammeAvecProgression } from '../db/repositories/programmeRepository';
import { getLastPulledAt } from '../db/database';
import { UtilisateurInfo } from '../types/auth';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

export default function DashboardScreen({ navigation }: Props): React.ReactElement {
  const [user, setUser] = useState<UtilisateurInfo | null>(null);
  const [programmes, setProgrammes] = useState<ProgrammeAvecProgression[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<number>(0);

  const loadLocalData = useCallback(async () => {
    const progs = await getProgrammesRecents();
    setProgrammes(progs);
    const lp = await getLastPulledAt();
    setLastSync(lp);
  }, []);

  useEffect(() => {
    fetchMe().then(setUser).catch(() => {});
    loadLocalData();
  }, [loadLocalData]);

  async function handleSync(): Promise<void> {
    setSyncing(true);
    try {
      const result = await pull();
      if (result.success) {
        const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
        await loadLocalData();
        Alert.alert(
          'Synchronisation reussie',
          `${total} enregistrement(s) recu(s).\n` +
          `Programmes : ${result.counts.programme ?? 0}\n` +
          `Etapes : ${result.counts.etape ?? 0}\n` +
          `PLV : ${result.counts.plv ?? 0}`,
        );
      } else {
        Alert.alert('Echec de la synchronisation', result.error ?? 'Erreur inconnue');
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await logout();
    navigation.replace('Login');
  }

  function renderProgramme({ item }: { item: ProgrammeAvecProgression }): React.ReactElement {
    return (
      <TouchableOpacity
        style={styles.progCard}
        onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
      >
        <View style={styles.progHeader}>
          <Text style={styles.progNumero}>{item.numero_x3}</Text>
          <View style={[
            styles.badge,
            item.type_programme === 'COLLECTE' ? styles.badgeCollecte : styles.badgeRestitution,
          ]}>
            <Text style={styles.badgeText}>{item.type_programme}</Text>
          </View>
        </View>
        <Text style={styles.progDate}>{item.date_programme}</Text>
        <Text style={styles.progProgress}>
          {item.etapes_visitees} / {item.total_etapes} etapes visitees
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcomeSmall}>Bonjour,</Text>
        <Text style={styles.welcomeBig}>
          {user ? `${user.first_name} ${user.last_name}` : '...'}
        </Text>
        <Text style={styles.subtitle}>
          {user?.code_livreur ?? ''}
        </Text>
      </View>

      <View style={styles.syncBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.syncLabel}>Derniere synchronisation</Text>
          <Text style={styles.syncValue}>
            {lastSync === 0 ? 'jamais' : new Date(lastSync).toLocaleString('fr-FR')}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.syncButtonText}>Synchroniser</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Mes programmes</Text>

      <FlatList
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProgramme}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={handleSync} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Aucun programme en local.{'\n'}
              Appuie sur "Synchroniser" pour recuperer ton programme du jour.
            </Text>
          </View>
        }
      />

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.debugButton}
          onPress={() => navigation.navigate('Debug')}
        >
          <Text style={styles.footerText}>Debug BDD</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.footerText}>Deconnexion</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#0d6efd', padding: 20, paddingTop: 44 },
  welcomeSmall: { color: '#cbe2ff', fontSize: 14 },
  welcomeBig: { color: '#fff', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#cbe2ff', fontSize: 14, marginTop: 2 },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 12,
    padding: 14,
    borderRadius: 10,
  },
  syncLabel: { fontSize: 12, color: '#888' },
  syncValue: { fontSize: 14, color: '#333', fontWeight: '600' },
  syncButton: {
    backgroundColor: '#0d6efd',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: {
    fontSize: 16, fontWeight: '700', color: '#333',
    marginHorizontal: 16, marginTop: 4, marginBottom: 8,
  },
  list: { paddingHorizontal: 12, paddingBottom: 12 },
  progCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    marginBottom: 10,
  },
  progHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progNumero: { fontSize: 15, fontWeight: '700', color: '#333' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  badgeCollecte: { backgroundColor: '#cfe2ff' },
  badgeRestitution: { backgroundColor: '#d1e7dd' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#333' },
  progDate: { color: '#888', fontSize: 13, marginTop: 4 },
  progProgress: { color: '#0d6efd', fontSize: 13, marginTop: 6, fontWeight: '600' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#888', textAlign: 'center', lineHeight: 22 },
  footer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  debugButton: { flex: 1, padding: 14, alignItems: 'center', backgroundColor: '#6c757d' },
  logoutButton: { flex: 1, padding: 14, alignItems: 'center', backgroundColor: '#dc3545' },
  footerText: { color: '#fff', fontWeight: '600' },
});
TSEOF

echo "  + DashboardScreen.tsx reecrit"

# -----------------------------------------------------------------------------
# src/screens/ProgrammeScreen.tsx - liste des etapes d'un programme
# -----------------------------------------------------------------------------
cat > src/screens/ProgrammeScreen.tsx << 'TSEOF'
/**
 * Ecran d'un programme : liste des etapes (PLV) a visiter dans l'ordre.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapesDuProgramme,
  getProgrammeById,
  EtapeAvecPlv,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Programme'>;

export default function ProgrammeScreen({ route }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [etapes, setEtapes] = useState<EtapeAvecPlv[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      const e = await getEtapesDuProgramme(programmeId);
      setProgramme(p);
      setEtapes(e);
      setLoading(false);
    })();
  }, [programmeId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  function renderEtape({ item }: { item: EtapeAvecPlv }): React.ReactElement {
    const visite = item.statut_visite === 'VISITEE';
    return (
      <View style={styles.card}>
        <View style={styles.ordreCircle}>
          <Text style={styles.ordreText}>{item.ordre_prevu}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.plvLibelle}>{item.plv_libelle}</Text>
          <Text style={styles.clientName}>{item.client_raison_sociale}</Text>
          <Text style={styles.coords}>
            {item.plv_latitude.toFixed(4)}, {item.plv_longitude.toFixed(4)}
          </Text>
        </View>
        <View style={[styles.statutBadge, visite ? styles.visitee : styles.aVisiter]}>
          <Text style={styles.statutText}>{visite ? 'Visitee' : 'A visiter'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {programme && (
        <View style={styles.header}>
          <Text style={styles.numero}>{programme.numero_x3}</Text>
          <Text style={styles.meta}>
            {programme.type_programme} - {programme.date_programme}
          </Text>
        </View>
      )}
      <FlatList
        data={etapes}
        keyExtractor={(item) => item.uuid}
        renderItem={renderEtape}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucune etape dans ce programme.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  numero: { fontSize: 18, fontWeight: '700', color: '#333' },
  meta: { fontSize: 14, color: '#888', marginTop: 4 },
  list: { padding: 12 },
  card: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ordreCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#0d6efd',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  ordreText: { color: '#fff', fontWeight: '700' },
  plvLibelle: { fontSize: 15, fontWeight: '600', color: '#333' },
  clientName: { fontSize: 13, color: '#666', marginTop: 2 },
  coords: { fontSize: 11, color: '#aaa', marginTop: 2, fontFamily: 'monospace' },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  visitee: { backgroundColor: '#d1e7dd' },
  aVisiter: { backgroundColor: '#fff3cd' },
  statutText: { fontSize: 11, fontWeight: '700', color: '#333' },
  empty: { textAlign: 'center', color: '#888', padding: 32 },
});
TSEOF

echo "  + ProgrammeScreen.tsx cree"

# =============================================================================
echo ""
echo "=== Mise a jour de la navigation ==="

python3 << 'PYEOF'
from pathlib import Path

# types/navigation.ts : ajouter Programme avec parametre
nav = Path("src/types/navigation.ts")
content = nav.read_text()
if "Programme:" not in content:
    content = content.replace(
        "  Debug: undefined;",
        "  Programme: { programmeId: number };\n  Debug: undefined;",
    )
    nav.write_text(content)
    print("  + type Programme ajoute")

# RootNavigator : importer et enregistrer ProgrammeScreen
root = Path("src/navigation/RootNavigator.tsx")
content = root.read_text()
if "ProgrammeScreen" not in content:
    content = content.replace(
        "import DebugScreen from '../screens/DebugScreen';",
        "import DebugScreen from '../screens/DebugScreen';\n"
        "import ProgrammeScreen from '../screens/ProgrammeScreen';",
    )
    content = content.replace(
        '<Stack.Screen name="Debug" component={DebugScreen} options={{ headerShown: true, title: "Debug BDD" }} />',
        '<Stack.Screen name="Programme" component={ProgrammeScreen} options={{ headerShown: true, title: "Programme" }} />\n'
        '        <Stack.Screen name="Debug" component={DebugScreen} options={{ headerShown: true, title: "Debug BDD" }} />',
    )
    root.write_text(content)
    print("  + ProgrammeScreen enregistre dans la navigation")
PYEOF

cd ..

# =============================================================================
echo ""
echo "=============================================="
echo "SPRINT 2.2 - PULL TERMINE."
echo "=============================================="
echo ""
echo "1. Assure-toi que Django tourne :"
echo "   python manage.py runserver 0.0.0.0:8000"
echo ""
echo "2. Assure-toi qu'il y a un programme du jour :"
echo "   python manage.py generer_programmes_du_jour"
echo ""
echo "3. Relance le mobile et recharge l'app :"
echo "   cd ~/sodigaz_poc/mobile && npx expo start"
echo ""
echo "4. Connecte-toi (LIV001 / demo1234), puis appuie sur 'Synchroniser'."
echo "   Tu dois voir une alerte 'Synchronisation reussie' avec des compteurs,"
echo "   puis ton programme du jour apparait dans la liste."
echo "   Tape dessus pour voir les etapes (PLV a visiter)."
echo ""
