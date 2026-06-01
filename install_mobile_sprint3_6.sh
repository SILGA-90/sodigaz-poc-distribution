#!/bin/bash
# =============================================================================
# Sprint 3.6 : cloture du programme (serveur + mobile)
#   SERVEUR : endpoint dedie /api/sync/programmes/cloturer/
#   MOBILE  : file d'attente de cloture (sync_meta), ecran de cloture (recap),
#             push des clotures pendant la synchronisation
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_6.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : execute depuis ~/sodigaz_poc"
    exit 1
fi

echo "=============================================="
echo " PARTIE 1/2 : SERVEUR (endpoint de cloture)"
echo "=============================================="

python3 << 'PYEOF'
from pathlib import Path

def rep_file(path, old, new, label):
    p = Path(path)
    c = p.read_text()
    if new.split("\n")[0].strip() and new.split("\n")[0].strip() in c and old not in c:
        print(f"  = deja present : {label}")
        return
    if old in c:
        c = c.replace(old, new, 1)
        p.write_text(c)
        print(f"  OK : {label}")
    else:
        print(f"  !! ECHEC (motif introuvable) : {label}")

# 1. import timezone dans sync_api/views.py
v = Path("sync_api/views.py")
vc = v.read_text()
if "from django.utils import timezone" not in vc:
    rep_file(
        "sync_api/views.py",
        "from django.shortcuts import get_object_or_404",
        "from django.shortcuts import get_object_or_404\nfrom django.utils import timezone",
        "import timezone",
    )
else:
    print("  = import timezone deja present")

# 2. ajouter la vue cloturer_programmes a la fin de views.py
vc = Path("sync_api/views.py").read_text()
if "def cloturer_programmes" not in vc:
    vue = '''

# ===========================================================================
# CLOTURE DE PROGRAMMES
# ===========================================================================

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cloturer_programmes(request):
    """
    Cloture un ou plusieurs programmes du livreur connecte.

    URL  : POST /api/sync/programmes/cloturer/
    Body : { "uuids": ["<uuid1>", "<uuid2>", ...] }

    Le statut passe a CLOTURE et l'heure de fin est horodatee cote serveur
    (evite tout probleme de format de date entre mobile et serveur).
    Filtre de securite : un livreur ne peut cloturer que SES programmes.
    """
    uuids = request.data.get("uuids", [])
    if not isinstance(uuids, list):
        return Response(
            {"status": "error", "detail": "Le champ 'uuids' doit etre une liste."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    heure_fin = timezone.localtime().time()
    count = 0
    for u in uuids:
        count += Programme.objects.filter(
            uuid=u, utilisateur=request.user, is_deleted=False,
        ).update(statut="CLOTURE", heure_fin=heure_fin)

    return Response({"status": "ok", "clotures": count}, status=status.HTTP_200_OK)
'''
    Path("sync_api/views.py").write_text(vc + vue)
    print("  OK : vue cloturer_programmes ajoutee")
else:
    print("  = vue cloturer_programmes deja presente")

# 3. route dans sync_api/urls.py
rep_file(
    "sync_api/urls.py",
    'path("photos/<uuid:uuid>/upload/", views.upload_photo, name="photo-upload"),',
    'path("photos/<uuid:uuid>/upload/", views.upload_photo, name="photo-upload"),\n'
    '    path("programmes/cloturer/", views.cloturer_programmes, name="cloturer-programmes"),',
    "route cloturer",
)
PYEOF

echo ""
echo "=============================================="
echo " PARTIE 2/2 : MOBILE"
echo "=============================================="

cd mobile

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null 2>&1 || true

echo "=== Regeneration de database.ts (helpers cloture + reset corrige) ==="

cat > src/db/database.ts << 'TSEOF'
/**
 * Gestion de la connexion a la base SQLite locale.
 */
import * as SQLite from 'expo-sqlite';

import { CREATE_TABLES_SQL, SCHEMA_VERSION } from './schema';

const DB_NAME = 'sodigaz.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

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

  dbInstance = db;
  return db;
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  const tables = [
    'sync_meta', 'client', 'plv', 'produit',
    'programme', 'etape', 'ligne_programme',
    'operation', 'ligne_operation', 'anomalie', 'photo',
  ];
  for (const table of tables) {
    await db.execAsync(`DROP TABLE IF EXISTS ${table};`);
  }
  await db.execAsync('PRAGMA user_version = 0;');
  dbInstance = null;
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
TSEOF

echo "  + database.ts regenere"

echo ""
echo "=== Regeneration de programmeRepository.ts (recap + cloture locale) ==="

cat > src/db/repositories/programmeRepository.ts << 'TSEOF'
/**
 * Repository des programmes : lecture, recap, cloture locale.
 */
import { getDatabase, addCloturePending } from '../database';
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

export interface RecapProgramme {
  total_etapes: number;
  etapes_visitees: number;
  nb_operations: number;
  montant_encaisse: number;
  nb_anomalies: number;
}

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

/**
 * Recapitulatif d'un programme pour l'ecran de cloture.
 */
export async function getRecapProgramme(
  programmeId: number,
  programmeUuid: string,
): Promise<RecapProgramme> {
  const db = await getDatabase();

  const etapes = await db.getFirstAsync<{ total: number; visitees: number }>(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN statut_visite = 'VISITEE' THEN 1 ELSE 0 END) AS visitees
     FROM etape WHERE programme_id = ? AND is_deleted = 0;`,
    [programmeId],
  );

  const ops = await db.getFirstAsync<{ nb: number; montant: number }>(
    `SELECT
        COUNT(DISTINCT o.uuid) AS nb,
        COALESCE(SUM(o.montant_encaisse), 0) AS montant
     FROM operation o
     JOIN etape e ON e.uuid = o.etape_uuid
     WHERE e.programme_id = ? AND o.is_deleted = 0;`,
    [programmeId],
  );

  const anomalies = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM anomalie WHERE programme_uuid = ? AND is_deleted = 0;`,
    [programmeUuid],
  );

  return {
    total_etapes: etapes?.total ?? 0,
    etapes_visitees: etapes?.visitees ?? 0,
    nb_operations: ops?.nb ?? 0,
    montant_encaisse: ops?.montant ?? 0,
    nb_anomalies: anomalies?.n ?? 0,
  };
}

/**
 * Cloture un programme localement : statut CLOTURE + heure de fin locale,
 * et inscription dans la file d'attente de remontee (sync_meta).
 */
export async function cloturerProgrammeLocal(
  programmeUuid: string,
): Promise<void> {
  const db = await getDatabase();
  const ts = Date.now();
  const heureFin = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  await db.runAsync(
    `UPDATE programme SET statut = 'CLOTURE', heure_fin = ?, last_modified = ?
     WHERE uuid = ?;`,
    [heureFin, ts, programmeUuid],
  );
  await addCloturePending(programmeUuid);
}
TSEOF

echo "  + programmeRepository.ts regenere"

echo ""
echo "=== Integration de la cloture dans syncService (avec verification) ==="

python3 << 'PYEOF'
from pathlib import Path

p = Path("src/sync/syncService.ts")
c = p.read_text()

def rep(old, new, label):
    global c
    if old in c:
        c = c.replace(old, new, 1)
        print(f"  OK : {label}")
    else:
        print(f"  !! ECHEC (motif introuvable) : {label}")

# 1. importer les helpers de cloture
rep(
    "import { getDatabase, getLastPulledAt, setLastPulledAt } from '../db/database';",
    "import { getDatabase, getLastPulledAt, setLastPulledAt, getCloturesPending, clearCloturesPending } from '../db/database';",
    "import helpers cloture",
)

# 2. modifier syncAll pour pousser les clotures AVANT le pull
rep(
    "export async function syncAll(): Promise<{ pull: PullResult; push: PushResult }> {\n"
    "  const pullResult = await pull();\n"
    "  const pushResult = await push();\n"
    "  return { pull: pullResult, push: pushResult };\n"
    "}",
    "export async function syncAll(): Promise<{ pull: PullResult; push: PushResult }> {\n"
    "  // Les clotures sont poussees AVANT le pull : ainsi le pull qui suit\n"
    "  // ramene un statut coherent (CLOTURE) et n'ecrase pas une cloture locale.\n"
    "  await pushClotures();\n"
    "  const pullResult = await pull();\n"
    "  const pushResult = await push();\n"
    "  return { pull: pullResult, push: pushResult };\n"
    "}\n\n"
    "/**\n"
    " * Remonte au serveur les programmes clotures localement (file sync_meta).\n"
    " * Best-effort : en cas d'echec reseau, la cloture reste en attente et\n"
    " * sera retentee au prochain cycle.\n"
    " */\n"
    "async function pushClotures(): Promise<void> {\n"
    "  const uuids = await getCloturesPending();\n"
    "  if (uuids.length === 0) return;\n"
    "  try {\n"
    "    await apiClient.post('/api/sync/programmes/cloturer/', { uuids });\n"
    "    await clearCloturesPending(uuids);\n"
    "  } catch (e) {\n"
    "    // on laisse en attente, retry au prochain cycle\n"
    "    console.warn('Push cloture echoue :', e);\n"
    "  }\n"
    "}",
    "syncAll + pushClotures",
)

p.write_text(c)
PYEOF

echo ""
echo "=== Creation de l'ecran de cloture ==="

cat > src/screens/ClotureScreen.tsx << 'TSEOF'
/**
 * Ecran de cloture d'un programme : recapitulatif + confirmation.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getProgrammeById,
  getRecapProgramme,
  cloturerProgrammeLocal,
  RecapProgramme,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Cloture'>;

export default function ClotureScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [recap, setRecap] = useState<RecapProgramme | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [closing, setClosing] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      if (p) {
        const r = await getRecapProgramme(programmeId, p.uuid);
        setProgramme(p);
        setRecap(r);
      }
      setLoading(false);
    })();
  }, [programmeId]);

  function confirmerCloture(): void {
    if (!programme || !recap) return;
    const reste = recap.total_etapes - recap.etapes_visitees;
    const message = reste > 0
      ? `Attention : ${reste} etape(s) non visitee(s). Cloturer quand meme ?`
      : 'Toutes les etapes sont visitees. Confirmer la cloture ?';
    Alert.alert('Cloturer le programme', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Cloturer', style: 'destructive', onPress: faireCloture },
    ]);
  }

  async function faireCloture(): Promise<void> {
    if (!programme) return;
    setClosing(true);
    try {
      await cloturerProgrammeLocal(programme.uuid);
      Alert.alert(
        'Programme cloture',
        'Le programme est cloture. Il sera remonte au superviseur a la prochaine synchronisation.',
        [{ text: 'OK', onPress: () => navigation.navigate('Dashboard') }],
      );
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  if (!programme || !recap) {
    return (
      <View style={styles.center}>
        <Text>Programme introuvable.</Text>
      </View>
    );
  }

  const dejaCloture = programme.statut === 'CLOTURE';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.numero}>{programme.numero_x3}</Text>
        <Text style={styles.meta}>{programme.type_programme} - {programme.date_programme}</Text>
      </View>

      <View style={styles.recapCard}>
        <Text style={styles.recapTitle}>Recapitulatif de la tournee</Text>

        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Etapes visitees</Text>
          <Text style={styles.recapValue}>{recap.etapes_visitees} / {recap.total_etapes}</Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Operations realisees</Text>
          <Text style={styles.recapValue}>{recap.nb_operations}</Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Montant encaisse</Text>
          <Text style={styles.recapValue}>{recap.montant_encaisse.toLocaleString('fr-FR')} FCFA</Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Anomalies signalees</Text>
          <Text style={styles.recapValue}>{recap.nb_anomalies}</Text>
        </View>
      </View>

      {dejaCloture ? (
        <View style={styles.clotureBadge}>
          <Text style={styles.clotureBadgeText}>Programme deja cloture</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.button, closing && styles.buttonDisabled]}
          onPress={confirmerCloture}
          disabled={closing}
        >
          {closing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Cloturer le programme</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#0d6efd', padding: 16 },
  numero: { color: '#fff', fontSize: 18, fontWeight: '700' },
  meta: { color: '#cbe2ff', fontSize: 14, marginTop: 4 },
  recapCard: { backgroundColor: '#fff', margin: 16, padding: 16, borderRadius: 12 },
  recapTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 12 },
  recapRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  recapLabel: { fontSize: 14, color: '#666' },
  recapValue: { fontSize: 15, fontWeight: '700', color: '#0d6efd' },
  button: {
    backgroundColor: '#198754', marginHorizontal: 16, padding: 16,
    borderRadius: 10, alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  clotureBadge: {
    marginHorizontal: 16, padding: 16, borderRadius: 10,
    backgroundColor: '#d1e7dd', alignItems: 'center',
  },
  clotureBadgeText: { color: '#0f5132', fontWeight: '700' },
});
TSEOF

echo "  + ClotureScreen.tsx cree"

echo ""
echo "=== Navigation + bouton de cloture dans ProgrammeScreen ==="

python3 << 'PYEOF'
from pathlib import Path

def rep_file(path, old, new, label):
    p = Path(path)
    c = p.read_text()
    if old in c:
        c = c.replace(old, new, 1)
        p.write_text(c)
        print(f"  OK : {label}")
    else:
        print(f"  !! ECHEC (motif introuvable) : {label}")

# 1. type navigation
rep_file(
    "src/types/navigation.ts",
    "  Anomalie: { programmeUuid: string };",
    "  Anomalie: { programmeUuid: string };\n  Cloture: { programmeId: number };",
    "type Cloture",
)

# 2. RootNavigator import + ecran
rep_file(
    "src/navigation/RootNavigator.tsx",
    "import AnomalieScreen from '../screens/AnomalieScreen';",
    "import AnomalieScreen from '../screens/AnomalieScreen';\n"
    "import ClotureScreen from '../screens/ClotureScreen';",
    "import ClotureScreen",
)
rep_file(
    "src/navigation/RootNavigator.tsx",
    '<Stack.Screen name="Anomalie" component={AnomalieScreen} options={{ headerShown: true, title: "Anomalie" }} />',
    '<Stack.Screen name="Anomalie" component={AnomalieScreen} options={{ headerShown: true, title: "Anomalie" }} />\n'
    '        <Stack.Screen name="Cloture" component={ClotureScreen} options={{ headerShown: true, title: "Cloture" }} />',
    "ecran Cloture dans navigation",
)

# 3. bouton Cloturer dans ProgrammeScreen (a cote du bouton anomalie)
rep_file(
    "src/screens/ProgrammeScreen.tsx",
    "          <TouchableOpacity\n"
    "            style={styles.anomalieBtn}\n"
    "            onPress={() => navigation.navigate('Anomalie', { programmeUuid: programme.uuid })}\n"
    "          >\n"
    "            <Text style={styles.anomalieBtnText}>Signaler une anomalie</Text>\n"
    "          </TouchableOpacity>",
    "          <TouchableOpacity\n"
    "            style={styles.anomalieBtn}\n"
    "            onPress={() => navigation.navigate('Anomalie', { programmeUuid: programme.uuid })}\n"
    "          >\n"
    "            <Text style={styles.anomalieBtnText}>Signaler une anomalie</Text>\n"
    "          </TouchableOpacity>\n"
    "          <TouchableOpacity\n"
    "            style={styles.clotureBtn}\n"
    "            onPress={() => navigation.navigate('Cloture', { programmeId: programme.id })}\n"
    "          >\n"
    "            <Text style={styles.clotureBtnText}>Cloturer le programme</Text>\n"
    "          </TouchableOpacity>",
    "bouton Cloturer",
)
rep_file(
    "src/screens/ProgrammeScreen.tsx",
    "  anomalieBtnText: { color: '#664d03', fontWeight: '700' },",
    "  anomalieBtnText: { color: '#664d03', fontWeight: '700' },\n"
    "  clotureBtn: {\n"
    "    marginTop: 8, padding: 10, borderRadius: 8,\n"
    "    backgroundColor: '#d1e7dd', borderWidth: 1, borderColor: '#198754',\n"
    "    alignItems: 'center',\n"
    "  },\n"
    "  clotureBtnText: { color: '#0f5132', fontWeight: '700' },",
    "styles bouton cloturer",
)
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.6 - CLOTURE TERMINEE."
echo "=============================================="
echo ""
echo "Verifie qu'aucun '!! ECHEC' n'apparait ci-dessus."
echo ""
echo "IMPORTANT : redemarre le serveur Django pour charger le nouvel endpoint :"
echo "  (Ctrl+C dans le terminal Django puis)"
echo "  python manage.py runserver 0.0.0.0:8000"
echo ""
echo "Test :"
echo "  1. Recharge l'app : npx expo start --clear puis reload."
echo "  2. Ouvre un programme : un bouton vert 'Cloturer le programme'"
echo "     apparait sous l'en-tete."
echo "  3. Tape dessus : l'ecran de cloture montre le recap (etapes, operations,"
echo "     montant encaisse, anomalies)."
echo "  4. Tape 'Cloturer le programme', confirme."
echo "  5. Reviens au Dashboard, synchronise."
echo "  6. Sur la supervision web -> onglet Programmes : le statut du"
echo "     programme est passe a CLOTURE, avec l'heure de fin."
echo ""
echo "Mode offline : cloture en mode avion, ca remonte au retour du reseau."
echo ""
