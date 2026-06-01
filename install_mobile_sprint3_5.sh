#!/bin/bash
# =============================================================================
# Sprint 3.5 du mobile : signalement d'anomalies
#   - ecran de signalement (type, gravite, description, photo, GPS)
#   - anomalieRepository : creation locale PENDING
#   - reutilise l'infra existante (push anomalie, photo anomalie, upload)
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_5.sh
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

echo "=== Creation de l'anomalieRepository ==="

cat > src/db/repositories/anomalieRepository.ts << 'TSEOF'
/**
 * Repository des anomalies : creation locale (PENDING) et comptage.
 * Le push des anomalies est deja gere par le syncService (Sprint 2.3).
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';

export interface AnomalieSaisie {
  programme_uuid: string;
  plv_id: number | null;
  type_anomalie: string;
  gravite: 'FAIBLE' | 'MOYENNE' | 'ELEVEE';
  description: string;
  latitude: number | null;
  longitude: number | null;
}

export async function creerAnomalie(data: AnomalieSaisie): Promise<string> {
  const db = await getDatabase();
  const uuid = Crypto.randomUUID();
  const ts = Date.now();
  await db.runAsync(
    `INSERT INTO anomalie
     (uuid, programme_uuid, plv_id, type_anomalie, gravite, description, statut,
      date_heure, latitude, longitude, sync_status, last_modified, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, 'OUVERTE', ?, ?, ?, 'PENDING', ?, 0);`,
    [
      uuid, data.programme_uuid, data.plv_id, data.type_anomalie, data.gravite,
      data.description, new Date().toISOString(), data.latitude, data.longitude, ts,
    ],
  );
  return uuid;
}

export async function countAnomaliesProgramme(programmeUuid: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM anomalie WHERE programme_uuid = ? AND is_deleted = 0;`,
    [programmeUuid],
  );
  return row?.n ?? 0;
}
TSEOF

echo "  + anomalieRepository.ts cree"

echo ""
echo "=== Regeneration du photoRepository (ajout photo anomalie) ==="

cat > src/db/repositories/photoRepository.ts << 'TSEOF'
/**
 * Repository des photos.
 * Une photo est rattachee soit a une operation, soit a une anomalie.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';

export interface PhotoLocale {
  uuid: string;
  operation_uuid: string | null;
  anomalie_uuid: string | null;
  local_uri: string;
  type_photo: string;
  date_heure: string;
  latitude: number | null;
  longitude: number | null;
  taille_octets: number | null;
  sync_status: 'PENDING' | 'SYNCED';
  upload_status: 'PENDING' | 'DONE';
  last_modified: number;
  is_deleted: number;
}

async function insertPhoto(
  operationUuid: string | null,
  anomalieUuid: string | null,
  localUri: string,
  typePhoto: string,
  tailleOctets: number,
  latitude: number | null,
  longitude: number | null,
): Promise<string> {
  const db = await getDatabase();
  const uuid = Crypto.randomUUID();
  const ts = Date.now();
  await db.runAsync(
    `INSERT INTO photo
     (uuid, operation_uuid, anomalie_uuid, local_uri, type_photo, date_heure,
      latitude, longitude, taille_octets, sync_status, upload_status,
      last_modified, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, 0);`,
    [uuid, operationUuid, anomalieUuid, localUri, typePhoto, new Date().toISOString(),
     latitude, longitude, tailleOctets, ts],
  );
  return uuid;
}

export function ajouterPhotoOperation(
  operationUuid: string,
  localUri: string,
  typePhoto: string,
  tailleOctets: number,
  latitude: number | null,
  longitude: number | null,
): Promise<string> {
  return insertPhoto(operationUuid, null, localUri, typePhoto, tailleOctets, latitude, longitude);
}

export function ajouterPhotoAnomalie(
  anomalieUuid: string,
  localUri: string,
  tailleOctets: number,
  latitude: number | null,
  longitude: number | null,
): Promise<string> {
  return insertPhoto(null, anomalieUuid, localUri, 'ANOMALIE', tailleOctets, latitude, longitude);
}

export async function getPhotosOperation(operationUuid: string): Promise<PhotoLocale[]> {
  const db = await getDatabase();
  return db.getAllAsync<PhotoLocale>(
    `SELECT * FROM photo WHERE operation_uuid = ? AND is_deleted = 0;`,
    [operationUuid],
  );
}

export async function getPhotosPendingMeta(): Promise<PhotoLocale[]> {
  const db = await getDatabase();
  return db.getAllAsync<PhotoLocale>(
    `SELECT * FROM photo WHERE sync_status = 'PENDING' AND is_deleted = 0;`,
  );
}

export async function getPhotosPendingUpload(): Promise<PhotoLocale[]> {
  const db = await getDatabase();
  return db.getAllAsync<PhotoLocale>(
    `SELECT * FROM photo
     WHERE sync_status = 'SYNCED' AND upload_status = 'PENDING' AND is_deleted = 0;`,
  );
}

export async function markPhotoMetaSynced(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const ph = uuids.map(() => '?').join(',');
  await db.runAsync(`UPDATE photo SET sync_status = 'SYNCED' WHERE uuid IN (${ph});`, uuids);
}

export async function markPhotoUploaded(uuid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE photo SET upload_status = 'DONE' WHERE uuid = ?;`, [uuid]);
}

export async function deletePhoto(uuid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE photo SET is_deleted = 1 WHERE uuid = ?;`, [uuid]);
}
TSEOF

echo "  + photoRepository.ts regenere (avec ajouterPhotoAnomalie)"

echo ""
echo "=== Regeneration de PhotosSection (type configurable) ==="

cat > src/components/PhotosSection.tsx << 'TSEOF'
/**
 * Section de gestion des photos (capture camera / galerie + miniatures).
 * Les types de photo sont configurables via la prop `types`
 * (defaut : types d'operation ; pour une anomalie on passe le type ANOMALIE).
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { prendrePhoto, choisirPhoto, PhotoCapturee } from '../services/photoService';

export interface PhotoEnAttente {
  uri: string;
  tailleOctets: number;
  type_photo: string;
}

interface TypeOption {
  label: string;
  value: string;
}

interface Props {
  photos: PhotoEnAttente[];
  onChange: (photos: PhotoEnAttente[]) => void;
  types?: TypeOption[];
}

const DEFAULT_TYPES: TypeOption[] = [
  { label: 'Bordereau', value: 'BORDEREAU' },
  { label: 'Livraison', value: 'LIVRAISON' },
  { label: 'Etat PLV', value: 'ETAT_PLV' },
];

export default function PhotosSection({ photos, onChange, types = DEFAULT_TYPES }: Props): React.ReactElement {
  const [busy, setBusy] = useState<boolean>(false);
  const [typeChoisi, setTypeChoisi] = useState<string>(types[0].value);

  async function ajouter(capture: () => Promise<PhotoCapturee | null>): Promise<void> {
    setBusy(true);
    try {
      const photo = await capture();
      if (photo) {
        onChange([...photos, { uri: photo.uri, tailleOctets: photo.tailleOctets, type_photo: typeChoisi }]);
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function retirer(index: number): void {
    onChange(photos.filter((_, i) => i !== index));
  }

  return (
    <View style={styles.container}>
      {types.length > 1 && (
        <View style={styles.typeRow}>
          {types.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.typeChip, typeChoisi === t.value && styles.typeChipActive]}
              onPress={() => setTypeChoisi(t.value)}
            >
              <Text style={[styles.typeChipText, typeChoisi === t.value && styles.typeChipTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionButton} onPress={() => ajouter(prendrePhoto)} disabled={busy}>
          <Text style={styles.actionText}>Prendre une photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => ajouter(choisirPhoto)} disabled={busy}>
          <Text style={styles.actionText}>Galerie</Text>
        </TouchableOpacity>
      </View>

      {busy && <ActivityIndicator color="#0d6efd" style={{ marginVertical: 8 }} />}

      {photos.length > 0 && (
        <ScrollView horizontal style={styles.thumbs} showsHorizontalScrollIndicator={false}>
          {photos.map((p, i) => (
            <View key={i} style={styles.thumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <TouchableOpacity style={styles.thumbRemove} onPress={() => retirer(i)}>
                <Text style={styles.thumbRemoveText}>X</Text>
              </TouchableOpacity>
              <Text style={styles.thumbType}>{p.type_photo}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', marginHorizontal: 12, padding: 14, borderRadius: 10 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e9ecef' },
  typeChipActive: { backgroundColor: '#0d6efd' },
  typeChipText: { fontSize: 12, color: '#333', fontWeight: '600' },
  typeChipTextActive: { color: '#fff' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#6c757d', alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  thumbs: { marginTop: 12 },
  thumbWrap: { marginRight: 10, alignItems: 'center' },
  thumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#eee' },
  thumbRemove: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: '#dc3545', width: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center',
  },
  thumbRemoveText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  thumbType: { fontSize: 10, color: '#888', marginTop: 2 },
});
TSEOF

echo "  + PhotosSection.tsx regenere (prop types)"

echo ""
echo "=== Creation de l'ecran de signalement d'anomalie ==="

cat > src/screens/AnomalieScreen.tsx << 'TSEOF'
/**
 * Ecran de signalement d'une anomalie sur un programme.
 * Type + gravite + description + photo(s) optionnelle(s) + geolocalisation.
 * Enregistrement local PENDING (offline-first), remonte a la sync.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { creerAnomalie } from '../db/repositories/anomalieRepository';
import { ajouterPhotoAnomalie } from '../db/repositories/photoRepository';
import { getCurrentPosition } from '../services/locationService';
import PhotosSection, { PhotoEnAttente } from '../components/PhotosSection';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Anomalie'>;

const TYPES_ANOMALIE = [
  'PLV ferme',
  'Client absent',
  'Refus de paiement',
  'Produit endommage',
  'Acces impossible',
  'Autre',
];

const GRAVITES: { label: string; value: 'FAIBLE' | 'MOYENNE' | 'ELEVEE'; color: string }[] = [
  { label: 'Faible', value: 'FAIBLE', color: '#198754' },
  { label: 'Moyenne', value: 'MOYENNE', color: '#ffc107' },
  { label: 'Elevee', value: 'ELEVEE', color: '#dc3545' },
];

export default function AnomalieScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeUuid } = route.params;

  const [typeAnomalie, setTypeAnomalie] = useState<string>(TYPES_ANOMALIE[0]);
  const [gravite, setGravite] = useState<'FAIBLE' | 'MOYENNE' | 'ELEVEE'>('MOYENNE');
  const [description, setDescription] = useState<string>('');
  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLon, setGpsLon] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'en cours' | 'ok' | 'indisponible'>('en cours');
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const pos = await getCurrentPosition();
        if (pos) {
          setGpsLat(pos.latitude);
          setGpsLon(pos.longitude);
          setGpsStatus('ok');
        } else {
          setGpsStatus('indisponible');
        }
      } catch {
        setGpsStatus('indisponible');
      }
    })();
  }, []);

  async function handleSave(): Promise<void> {
    if (!description.trim()) {
      Alert.alert('Description manquante', 'Decris brievement l\'anomalie.');
      return;
    }
    setSaving(true);
    try {
      const anomalieUuid = await creerAnomalie({
        programme_uuid: programmeUuid,
        plv_id: null,
        type_anomalie: typeAnomalie,
        gravite,
        description: description.trim(),
        latitude: gpsLat,
        longitude: gpsLon,
      });

      for (const ph of photos) {
        await ajouterPhotoAnomalie(anomalieUuid, ph.uri, ph.tailleOctets, gpsLat, gpsLon);
      }

      Alert.alert(
        'Anomalie enregistree',
        'L\'anomalie est enregistree localement. Elle sera remontee a la prochaine synchronisation.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Signaler une anomalie</Text>
        <Text style={styles.gpsStatus}>Position GPS : {gpsStatus}</Text>
      </View>

      <Text style={styles.sectionTitle}>Type d'anomalie</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={typeAnomalie} onValueChange={(v) => setTypeAnomalie(v)}>
          {TYPES_ANOMALIE.map((t) => (
            <Picker.Item key={t} label={t} value={t} />
          ))}
        </Picker>
      </View>

      <Text style={styles.sectionTitle}>Gravite</Text>
      <View style={styles.graviteRow}>
        {GRAVITES.map((g) => (
          <TouchableOpacity
            key={g.value}
            style={[
              styles.graviteChip,
              gravite === g.value && { backgroundColor: g.color, borderColor: g.color },
            ]}
            onPress={() => setGravite(g.value)}
          >
            <Text style={[styles.graviteText, gravite === g.value && styles.graviteTextActive]}>
              {g.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Description</Text>
      <TextInput
        style={styles.description}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Decris l'anomalie rencontree..."
      />

      <Text style={styles.sectionTitle}>Photo (optionnel)</Text>
      <PhotosSection
        photos={photos}
        onChange={setPhotos}
        types={[{ label: 'Anomalie', value: 'ANOMALIE' }]}
      />

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>Enregistrer l'anomalie</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#dc3545', padding: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  gpsStatus: { color: '#ffd9dd', fontSize: 12, marginTop: 4 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: '#333',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  pickerWrap: {
    backgroundColor: '#fff', marginHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#ccc',
  },
  graviteRow: { flexDirection: 'row', gap: 8, marginHorizontal: 12 },
  graviteChip: {
    flex: 1, padding: 12, borderRadius: 8, alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc',
  },
  graviteText: { fontWeight: '600', color: '#333' },
  graviteTextActive: { color: '#fff' },
  description: {
    backgroundColor: '#fff', marginHorizontal: 12, padding: 12,
    borderRadius: 10, minHeight: 90, textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: '#dc3545', margin: 16, padding: 16,
    borderRadius: 10, alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
TSEOF

echo "  + AnomalieScreen.tsx cree"

echo ""
echo "=== Navigation + bouton dans ProgrammeScreen (avec verification) ==="

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

# 1. type de navigation
rep_file(
    "src/types/navigation.ts",
    "  SaisieOperation: { etapeId: number };",
    "  SaisieOperation: { etapeId: number };\n  Anomalie: { programmeUuid: string };",
    "type Anomalie",
)

# 2. RootNavigator : import + ecran
rep_file(
    "src/navigation/RootNavigator.tsx",
    "import SaisieOperationScreen from '../screens/SaisieOperationScreen';",
    "import SaisieOperationScreen from '../screens/SaisieOperationScreen';\n"
    "import AnomalieScreen from '../screens/AnomalieScreen';",
    "import AnomalieScreen",
)
rep_file(
    "src/navigation/RootNavigator.tsx",
    '<Stack.Screen name="SaisieOperation" component={SaisieOperationScreen} options={{ headerShown: true, title: "Saisie operation" }} />',
    '<Stack.Screen name="SaisieOperation" component={SaisieOperationScreen} options={{ headerShown: true, title: "Saisie operation" }} />\n'
    '        <Stack.Screen name="Anomalie" component={AnomalieScreen} options={{ headerShown: true, title: "Anomalie" }} />',
    "ecran Anomalie dans navigation",
)

# 3. ProgrammeScreen : bouton "Signaler une anomalie" dans le header
rep_file(
    "src/screens/ProgrammeScreen.tsx",
    "          <Text style={styles.meta}>\n"
    "            {programme.type_programme} - {programme.date_programme}\n"
    "          </Text>\n"
    "        </View>",
    "          <Text style={styles.meta}>\n"
    "            {programme.type_programme} - {programme.date_programme}\n"
    "          </Text>\n"
    "          <TouchableOpacity\n"
    "            style={styles.anomalieBtn}\n"
    "            onPress={() => navigation.navigate('Anomalie', { programmeUuid: programme.uuid })}\n"
    "          >\n"
    "            <Text style={styles.anomalieBtnText}>Signaler une anomalie</Text>\n"
    "          </TouchableOpacity>\n"
    "        </View>",
    "bouton Signaler anomalie",
)
rep_file(
    "src/screens/ProgrammeScreen.tsx",
    "  meta: { fontSize: 14, color: '#888', marginTop: 4 },",
    "  meta: { fontSize: 14, color: '#888', marginTop: 4 },\n"
    "  anomalieBtn: {\n"
    "    marginTop: 12, padding: 10, borderRadius: 8,\n"
    "    backgroundColor: '#fff3cd', borderWidth: 1, borderColor: '#ffc107',\n"
    "    alignItems: 'center',\n"
    "  },\n"
    "  anomalieBtnText: { color: '#664d03', fontWeight: '700' },",
    "styles bouton anomalie",
)
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.5 - ANOMALIES TERMINEES."
echo "=============================================="
echo ""
echo "Verifie qu'aucun '!! ECHEC' n'apparait ci-dessus avant de tester."
echo ""
echo "Test :"
echo "  1. Recharge l'app : npx expo start --clear puis reload."
echo "  2. Ouvre un programme. Un bouton jaune 'Signaler une anomalie'"
echo "     apparait sous l'en-tete."
echo "  3. Choisis un type, une gravite, decris l'anomalie, ajoute une"
echo "     photo si tu veux. Enregistre."
echo "  4. Reviens au Dashboard, synchronise."
echo "  5. Sur la supervision web -> onglet Anomalies : ton anomalie"
echo "     apparait avec son type, sa gravite, sa description."
echo ""
echo "Le mode offline fonctionne aussi : signale en mode avion, ca remonte"
echo "au retour du reseau."
echo ""
