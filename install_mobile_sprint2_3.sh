#!/bin/bash
# =============================================================================
# Sprint 2.3 du mobile : synchronisation PUSH + cycle complet
#   - SyncService.push() : remonte les operations/lignes/anomalies PENDING
#   - operationRepository : creation locale + lecture des PENDING + markSynced
#   - bouton de test dans Debug pour creer une operation factice
#   - bouton Synchroniser = pull PUIS push
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint2_3.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : execute depuis ~/sodigaz_poc"
    exit 1
fi

cd mobile

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null 2>&1 || true

echo "=== Installation d'expo-crypto (pour generer des UUID) ==="
npx expo install expo-crypto

echo ""
echo "=== Creation des fichiers ==="

# -----------------------------------------------------------------------------
# src/db/repositories/operationRepository.ts
# -----------------------------------------------------------------------------
cat > src/db/repositories/operationRepository.ts << 'TSEOF'
/**
 * Repository des operations : creation locale, lecture des PENDING, marquage SYNCED.
 *
 * Les operations sont creees sur le mobile (hors ligne possible) avec
 * sync_status = 'PENDING'. Le service de push les remonte au serveur et
 * les passe a 'SYNCED'.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';
import { Operation, LigneOperation, Anomalie } from '../../types/models';

function nowMs(): number {
  return Date.now();
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Cree une operation de TEST (Sprint 2.3, en attendant les vrais formulaires
 * du Sprint 3). Prend une etape et un produit existants en local.
 */
export async function createOperationTest(): Promise<string> {
  const db = await getDatabase();

  // Prendre la premiere etape disponible
  const etape = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM etape WHERE is_deleted = 0 LIMIT 1;',
  );
  if (!etape) {
    throw new Error('Aucune etape en local. Synchronise d\'abord (pull).');
  }

  // Prendre le premier produit disponible
  const produit = await db.getFirstAsync<{ code_x3: string; prix_unitaire: number }>(
    'SELECT code_x3, prix_unitaire FROM produit LIMIT 1;',
  );
  if (!produit) {
    throw new Error('Aucun produit en local. Synchronise d\'abord (pull).');
  }

  const opUuid = Crypto.randomUUID();
  const ligneUuid = Crypto.randomUUID();
  const ts = nowMs();
  const montant = produit.prix_unitaire * 2;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO operation
       (uuid, etape_uuid, type_operation, sous_type, date_heure,
        latitude, longitude, mode_paiement, montant_total, montant_encaisse,
        est_encaissee, signature_livreur, signature_client, nom_signataire_client,
        commentaire, sync_status, last_modified, is_deleted)
       VALUES (?, ?, 'COLLECTE', 'BCR', ?, 12.3650, -1.5236, 'ESPECES',
               ?, ?, 1, '', '', 'Client test', 'Operation de test (Sprint 2.3)',
               'PENDING', ?, 0);`,
      [opUuid, etape.uuid, nowIso(), montant, montant, ts],
    );
    await db.runAsync(
      `INSERT INTO ligne_operation
       (uuid, operation_uuid, produit_code_x3, quantite_realisee,
        quantite_collectee_vide, quantite_consignee, quantite_deconsignee,
        montant_ligne, sync_status, last_modified, is_deleted)
       VALUES (?, ?, ?, 2, 0, 0, 0, ?, 'PENDING', ?, 0);`,
      [ligneUuid, opUuid, produit.code_x3, montant, ts],
    );
  });

  return opUuid;
}

// ---- Lecture des PENDING (pour le push) ----

export async function getPendingOperations(): Promise<Operation[]> {
  const db = await getDatabase();
  return db.getAllAsync<Operation>(
    "SELECT * FROM operation WHERE sync_status = 'PENDING' AND is_deleted = 0;",
  );
}

export async function getPendingLignesOperation(): Promise<LigneOperation[]> {
  const db = await getDatabase();
  return db.getAllAsync<LigneOperation>(
    "SELECT * FROM ligne_operation WHERE sync_status = 'PENDING' AND is_deleted = 0;",
  );
}

export async function getPendingAnomalies(): Promise<Anomalie[]> {
  const db = await getDatabase();
  return db.getAllAsync<Anomalie>(
    "SELECT * FROM anomalie WHERE sync_status = 'PENDING' AND is_deleted = 0;",
  );
}

// ---- Marquage SYNCED apres push reussi ----

export async function markOperationsSynced(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const placeholders = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE operation SET sync_status = 'SYNCED' WHERE uuid IN (${placeholders});`,
    uuids,
  );
}

export async function markLignesSynced(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const placeholders = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE ligne_operation SET sync_status = 'SYNCED' WHERE uuid IN (${placeholders});`,
    uuids,
  );
}

export async function markAnomaliesSynced(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const placeholders = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE anomalie SET sync_status = 'SYNCED' WHERE uuid IN (${placeholders});`,
    uuids,
  );
}

export async function countPending(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM operation WHERE sync_status='PENDING' AND is_deleted=0) +
       (SELECT COUNT(*) FROM ligne_operation WHERE sync_status='PENDING' AND is_deleted=0) +
       (SELECT COUNT(*) FROM anomalie WHERE sync_status='PENDING' AND is_deleted=0) AS n;`,
  );
  return row?.n ?? 0;
}
TSEOF

echo "  + operationRepository.ts cree"

# -----------------------------------------------------------------------------
# Ajout de push() au syncService
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

sync = Path("src/sync/syncService.ts")
content = sync.read_text()

# Ajouter les imports du repository en haut, apres l'import de database
content = content.replace(
    "import { getDatabase, getLastPulledAt, setLastPulledAt } from '../db/database';",
    "import { getDatabase, getLastPulledAt, setLastPulledAt } from '../db/database';\n"
    "import {\n"
    "  getPendingOperations,\n"
    "  getPendingLignesOperation,\n"
    "  getPendingAnomalies,\n"
    "  markOperationsSynced,\n"
    "  markLignesSynced,\n"
    "  markAnomaliesSynced,\n"
    "} from '../db/repositories/operationRepository';",
)

# Ajouter le code de push a la fin du fichier
push_code = '''

// ===========================================================================
// PUSH (Sprint 2.3)
// ===========================================================================

export interface PushResult {
  success: boolean;
  pushed: { operation: number; ligne_operation: number; anomalie: number };
  error?: string;
}

/**
 * Remonte au serveur toutes les operations / lignes / anomalies PENDING.
 *
 * Format envoye (conforme a /api/sync/push/) :
 *   {
 *     lastPulledAt,
 *     changes: {
 *       operation:       { created: [...], updated: [], deleted: [] },
 *       ligne_operation: { created: [...], updated: [], deleted: [] },
 *       anomalie:        { created: [...], updated: [], deleted: [] }
 *     }
 *   }
 */
export async function push(): Promise<PushResult> {
  const operations = await getPendingOperations();
  const lignes = await getPendingLignesOperation();
  const anomalies = await getPendingAnomalies();

  const empty = { operation: 0, ligne_operation: 0, anomalie: 0 };

  // Rien a pousser : succes immediat
  if (operations.length === 0 && lignes.length === 0 && anomalies.length === 0) {
    return { success: true, pushed: empty };
  }

  const lastPulledAt = await getLastPulledAt();

  const payload = {
    lastPulledAt,
    changes: {
      operation: {
        created: operations.map((o) => ({
          uuid: o.uuid,
          etape_uuid: o.etape_uuid,
          type_operation: o.type_operation,
          sous_type: o.sous_type ?? null,
          date_heure: o.date_heure,
          latitude: o.latitude,
          longitude: o.longitude,
          mode_paiement: o.mode_paiement ?? null,
          montant_total: o.montant_total,
          montant_encaisse: o.montant_encaisse,
          est_encaissee: o.est_encaissee === 1,
          signature_livreur: o.signature_livreur ?? '',
          signature_client: o.signature_client ?? '',
          nom_signataire_client: o.nom_signataire_client ?? '',
          commentaire: o.commentaire ?? '',
        })),
        updated: [],
        deleted: [],
      },
      ligne_operation: {
        created: lignes.map((l) => ({
          uuid: l.uuid,
          operation_uuid: l.operation_uuid,
          produit_code_x3: l.produit_code_x3,
          quantite_realisee: l.quantite_realisee,
          quantite_collectee_vide: l.quantite_collectee_vide,
          quantite_consignee: l.quantite_consignee,
          quantite_deconsignee: l.quantite_deconsignee,
          montant_ligne: l.montant_ligne,
        })),
        updated: [],
        deleted: [],
      },
      anomalie: {
        created: anomalies.map((a) => ({
          uuid: a.uuid,
          programme_uuid: a.programme_uuid,
          plv_id: a.plv_id,
          type_anomalie: a.type_anomalie,
          gravite: a.gravite,
          description: a.description,
          statut: a.statut,
          date_heure: a.date_heure,
          latitude: a.latitude,
          longitude: a.longitude,
        })),
        updated: [],
        deleted: [],
      },
    },
  };

  try {
    await apiClient.post('/api/sync/push/', payload);
  } catch (e: any) {
    return {
      success: false,
      pushed: empty,
      error: e?.response?.data?.detail ?? e?.message ?? 'Erreur reseau',
    };
  }

  // Marquer SYNCED ce qui a ete pousse avec succes
  await markOperationsSynced(operations.map((o) => o.uuid));
  await markLignesSynced(lignes.map((l) => l.uuid));
  await markAnomaliesSynced(anomalies.map((a) => a.uuid));

  return {
    success: true,
    pushed: {
      operation: operations.length,
      ligne_operation: lignes.length,
      anomalie: anomalies.length,
    },
  };
}

/**
 * Synchronisation complete : pull PUIS push.
 */
export async function syncAll(): Promise<{ pull: PullResult; push: PushResult }> {
  const pullResult = await pull();
  const pushResult = await push();
  return { pull: pullResult, push: pushResult };
}
'''

content += push_code
sync.write_text(content)
print("  + push() et syncAll() ajoutes au syncService")
PYEOF

# -----------------------------------------------------------------------------
# Mise a jour du DashboardScreen : le bouton fait syncAll (pull + push)
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

dash = Path("src/screens/DashboardScreen.tsx")
content = dash.read_text()

# Remplacer l'import de pull par syncAll
content = content.replace(
    "import { pull } from '../sync/syncService';",
    "import { syncAll } from '../sync/syncService';",
)

# Remplacer le corps de handleSync
old_handle = '''  async function handleSync(): Promise<void> {
    setSyncing(true);
    try {
      const result = await pull();
      if (result.success) {
        const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
        await loadLocalData();
        Alert.alert(
          'Synchronisation reussie',
          `${total} enregistrement(s) recu(s).\\n` +
          `Programmes : ${result.counts.programme ?? 0}\\n` +
          `Etapes : ${result.counts.etape ?? 0}\\n` +
          `PLV : ${result.counts.plv ?? 0}`,
        );
      } else {
        Alert.alert('Echec de la synchronisation', result.error ?? 'Erreur inconnue');
      }
    } finally {
      setSyncing(false);
    }
  }'''

new_handle = '''  async function handleSync(): Promise<void> {
    setSyncing(true);
    try {
      const { pull: pullRes, push: pushRes } = await syncAll();
      await loadLocalData();

      if (!pullRes.success) {
        Alert.alert('Echec du pull', pullRes.error ?? 'Erreur inconnue');
        return;
      }
      if (!pushRes.success) {
        Alert.alert('Echec du push', pushRes.error ?? 'Erreur inconnue');
        return;
      }

      const recus = Object.values(pullRes.counts).reduce((a, b) => a + b, 0);
      const envoyes =
        pushRes.pushed.operation +
        pushRes.pushed.ligne_operation +
        pushRes.pushed.anomalie;

      Alert.alert(
        'Synchronisation reussie',
        `Recus du serveur : ${recus}\\n` +
        `  - Programmes : ${pullRes.counts.programme ?? 0}\\n` +
        `  - Etapes : ${pullRes.counts.etape ?? 0}\\n\\n` +
        `Envoyes au serveur : ${envoyes}\\n` +
        `  - Operations : ${pushRes.pushed.operation}\\n` +
        `  - Lignes : ${pushRes.pushed.ligne_operation}\\n` +
        `  - Anomalies : ${pushRes.pushed.anomalie}`,
      );
    } finally {
      setSyncing(false);
    }
  }'''

content = content.replace(old_handle, new_handle)
dash.write_text(content)
print("  + handleSync mis a jour (pull + push)")
PYEOF

# -----------------------------------------------------------------------------
# Ajout du bouton "Creer operation test" dans le DebugScreen
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

debug = Path("src/screens/DebugScreen.tsx")
content = debug.read_text()

# Ajouter l'import du repository + countPending
content = content.replace(
    "import { getTableCounts, TableCounts } from '../db/repositories/debugRepository';",
    "import { getTableCounts, TableCounts } from '../db/repositories/debugRepository';\n"
    "import { createOperationTest, countPending } from '../db/repositories/operationRepository';\n"
    "import { Alert } from 'react-native';",
)

# Ajouter un state pending + la fonction de creation, juste apres le state error
content = content.replace(
    "  const [error, setError] = useState<string | null>(null);",
    "  const [error, setError] = useState<string | null>(null);\n"
    "  const [pending, setPending] = useState<number>(0);",
)

# Mettre a jour refresh pour lire aussi le pending
content = content.replace(
    "      const lp = await getLastPulledAt();\n"
    "      setCounts(c);\n"
    "      setLastPull(lp);",
    "      const lp = await getLastPulledAt();\n"
    "      const p = await countPending();\n"
    "      setCounts(c);\n"
    "      setLastPull(lp);\n"
    "      setPending(p);",
)

# Ajouter la fonction handleCreateTest avant le return
content = content.replace(
    "  return (\n    <ScrollView style={styles.container}>",
    "  async function handleCreateTest(): Promise<void> {\n"
    "    try {\n"
    "      const uuid = await createOperationTest();\n"
    "      Alert.alert('Operation de test creee', `UUID : ${uuid.slice(0, 8)}...\\nElle est PENDING. Va sur le Dashboard et synchronise pour la remonter.`);\n"
    "      await refresh();\n"
    "    } catch (e: any) {\n"
    "      Alert.alert('Erreur', e?.message ?? String(e));\n"
    "    }\n"
    "  }\n\n"
    "  return (\n    <ScrollView style={styles.container}>",
)

# Ajouter l'affichage du pending + le bouton, juste avant le bouton Rafraichir
content = content.replace(
    '      <TouchableOpacity style={styles.button} onPress={refresh}>\n'
    '        <Text style={styles.buttonText}>Rafraichir</Text>\n'
    '      </TouchableOpacity>',
    '      <View style={styles.pendingBox}>\n'
    '        <Text style={styles.pendingText}>\n'
    '          En attente de synchronisation (PENDING) : {pending}\n'
    '        </Text>\n'
    '      </View>\n\n'
    '      <TouchableOpacity style={[styles.button, styles.buttonTest]} onPress={handleCreateTest}>\n'
    '        <Text style={styles.buttonText}>Creer une operation de test</Text>\n'
    '      </TouchableOpacity>\n\n'
    '      <TouchableOpacity style={styles.button} onPress={refresh}>\n'
    '        <Text style={styles.buttonText}>Rafraichir</Text>\n'
    '      </TouchableOpacity>',
)

# Ajouter les styles
content = content.replace(
    "  buttonDanger: { backgroundColor: '#dc3545' },",
    "  buttonDanger: { backgroundColor: '#dc3545' },\n"
    "  buttonTest: { backgroundColor: '#198754' },\n"
    "  pendingBox: { backgroundColor: '#fff3cd', padding: 12, borderRadius: 8, marginBottom: 12 },\n"
    "  pendingText: { color: '#664d03', fontWeight: '600', textAlign: 'center' },",
)

debug.write_text(content)
print("  + bouton 'Creer operation test' ajoute au DebugScreen")
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 2.3 - PUSH TERMINE."
echo "=============================================="
echo ""
echo "Scenario de test du cycle complet :"
echo ""
echo "  1. Django tourne (python manage.py runserver 0.0.0.0:8000)"
echo "  2. Recharge l'app, connecte-toi (LIV001 / demo1234)"
echo "  3. Synchronise une premiere fois (recupere le programme)"
echo "  4. Va dans 'Debug BDD' -> 'Creer une operation de test'"
echo "     (le compteur PENDING passe a 2 : 1 operation + 1 ligne)"
echo "  5. ACTIVE LE MODE AVION (pour prouver l'offline)"
echo "  6. Cree une 2e operation de test en mode avion (PENDING = 4)"
echo "  7. DESACTIVE le mode avion"
echo "  8. Retourne au Dashboard, appuie sur 'Synchroniser'"
echo "     -> l'alerte doit indiquer 'Envoyes au serveur : 4'"
echo "  9. Verifie cote serveur : va sur http://localhost:8000/supervision/"
echo "     onglet Operations -> tes operations de test apparaissent !"
echo ""
echo "C'est le cycle offline-first complet : saisie hors ligne -> remontee."
echo ""
