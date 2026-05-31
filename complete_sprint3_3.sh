#!/bin/bash
# =============================================================================
# Sprint 3.3 - COMPLETION (le script initial s'est arrete au milieu)
#
# Etat constate :
#   - schema.ts : version 2 + table photo  -> DEJA FAIT, on n'y touche pas
#   - database.ts : migration v1->v2        -> DEJA FAIT, on n'y touche pas
#   - dependances expo-image-*/file-system  -> DEJA INSTALLEES
#
# Ce script fait UNIQUEMENT ce qui manque :
#   - cree photoRepository.ts, photoService.ts, PhotosSection.tsx
#   - modifie syncService.ts (push meta photo + upload binaire)
#   - NE TOUCHE PAS au SaisieOperationScreen (fait separement, a la main)
# Usage : depuis ~/sodigaz_poc, bash complete_sprint3_3.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : execute depuis ~/sodigaz_poc"
    exit 1
fi

cd mobile

# Verification de securite : s'assurer qu'on ne refait pas le travail
if [ -f "src/components/PhotosSection.tsx" ]; then
    echo "ATTENTION : PhotosSection.tsx existe deja."
    echo "Ce script suppose qu'il n'existe pas. Verifie l'etat avant de continuer."
    exit 1
fi

mkdir -p src/services src/db/repositories

echo "=== 1/4 : photoRepository.ts ==="
cat > src/db/repositories/photoRepository.ts << 'TSEOF'
/**
 * Repository des photos.
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

export async function ajouterPhotoOperation(
  operationUuid: string,
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
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, 0);`,
    [uuid, operationUuid, localUri, typePhoto, new Date().toISOString(),
     latitude, longitude, tailleOctets, ts],
  );
  return uuid;
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
echo "  OK"

echo "=== 2/4 : photoService.ts ==="
cat > src/services/photoService.ts << 'TSEOF'
/**
 * Service de capture et compression de photos.
 *
 * - prendrePhoto() : ouvre la camera
 * - choisirPhoto() : ouvre la galerie (pratique pour les tests)
 * Les deux retournent une image compressee (uri locale + taille).
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

export interface PhotoCapturee {
  uri: string;
  tailleOctets: number;
}

const LARGEUR_MAX = 1024;
const QUALITE = 0.6;

async function compresser(uri: string): Promise<PhotoCapturee> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: LARGEUR_MAX } }],
    { compress: QUALITE, format: ImageManipulator.SaveFormat.JPEG },
  );

  const info = await FileSystem.getInfoAsync(result.uri);
  const taille = info.exists && 'size' in info ? (info as any).size : 0;

  return { uri: result.uri, tailleOctets: taille };
}

export async function prendrePhoto(): Promise<PhotoCapturee | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission camera refusee.');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  return compresser(result.assets[0].uri);
}

export async function choisirPhoto(): Promise<PhotoCapturee | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission galerie refusee.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  return compresser(result.assets[0].uri);
}
TSEOF
echo "  OK"

echo "=== 3/4 : PhotosSection.tsx ==="
cat > src/components/PhotosSection.tsx << 'TSEOF'
/**
 * Section de gestion des photos d'une operation.
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

interface Props {
  photos: PhotoEnAttente[];
  onChange: (photos: PhotoEnAttente[]) => void;
}

const TYPES = [
  { label: 'Bordereau', value: 'BORDEREAU' },
  { label: 'Livraison', value: 'LIVRAISON' },
  { label: 'Etat PLV', value: 'ETAT_PLV' },
];

export default function PhotosSection({ photos, onChange }: Props): React.ReactElement {
  const [busy, setBusy] = useState<boolean>(false);
  const [typeChoisi, setTypeChoisi] = useState<string>('LIVRAISON');

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
      <View style={styles.typeRow}>
        {TYPES.map((t) => (
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
echo "  OK"

echo "=== 4/4 : modification de syncService.ts ==="

python3 << 'PYEOF'
from pathlib import Path

sync = Path("src/sync/syncService.ts")
content = sync.read_text()

# Verification de securite : ne pas modifier deux fois
if "uploaderPhotosBinaires" in content:
    print("  = syncService deja modifie, rien a faire")
else:
    # 1. Ajout des imports (apres l'import du operationRepository)
    old_import = """import {
  getPendingOperations,
  getPendingLignesOperation,
  getPendingAnomalies,
  markOperationsSynced,
  markLignesSynced,
  markAnomaliesSynced,
} from '../db/repositories/operationRepository';"""

    new_import = """import {
  getPendingOperations,
  getPendingLignesOperation,
  getPendingAnomalies,
  markOperationsSynced,
  markLignesSynced,
  markAnomaliesSynced,
} from '../db/repositories/operationRepository';
import {
  getPhotosPendingMeta,
  getPhotosPendingUpload,
  markPhotoMetaSynced,
  markPhotoUploaded,
} from '../db/repositories/photoRepository';
import * as FileSystem from 'expo-file-system';
import { API_BASE_URL } from '../config/api';
import { getItem, STORAGE_KEYS } from '../storage/secureStorage';"""

    assert old_import in content, "Import operationRepository introuvable"
    content = content.replace(old_import, new_import)

    # 2. Charger photosMeta au debut de push()
    old_load = """  const operations = await getPendingOperations();
  const lignes = await getPendingLignesOperation();
  const anomalies = await getPendingAnomalies();

  const empty = { operation: 0, ligne_operation: 0, anomalie: 0 };

  // Rien a pousser : succes immediat
  if (operations.length === 0 && lignes.length === 0 && anomalies.length === 0) {
    return { success: true, pushed: empty };
  }"""

    new_load = """  const operations = await getPendingOperations();
  const lignes = await getPendingLignesOperation();
  const anomalies = await getPendingAnomalies();
  const photosMeta = await getPhotosPendingMeta();

  const empty = { operation: 0, ligne_operation: 0, anomalie: 0 };

  // Rien a pousser en meta : on tente quand meme les uploads binaires en attente
  if (operations.length === 0 && lignes.length === 0 && anomalies.length === 0 && photosMeta.length === 0) {
    await uploaderPhotosBinaires();
    return { success: true, pushed: empty };
  }"""

    assert old_load in content, "Bloc de chargement push introuvable"
    content = content.replace(old_load, new_load)

    # 3. Ajouter la cle photo dans le payload (apres le bloc anomalie)
    old_payload = """      anomalie: {
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
  };"""

    new_payload = """      anomalie: {
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
      photo: {
        created: photosMeta.map((p) => ({
          uuid: p.uuid,
          operation_uuid: p.operation_uuid,
          anomalie_uuid: p.anomalie_uuid,
          type_photo: p.type_photo,
          date_heure: p.date_heure,
          latitude: p.latitude,
          longitude: p.longitude,
          taille_octets: p.taille_octets,
        })),
        updated: [],
        deleted: [],
      },
    },
  };"""

    assert old_payload in content, "Bloc payload anomalie introuvable"
    content = content.replace(old_payload, new_payload)

    # 4. Marquer les photos meta + lancer uploads apres les autres marquages
    old_mark = """  // Marquer SYNCED ce qui a ete pousse avec succes
  await markOperationsSynced(operations.map((o) => o.uuid));
  await markLignesSynced(lignes.map((l) => l.uuid));
  await markAnomaliesSynced(anomalies.map((a) => a.uuid));"""

    new_mark = """  // Marquer SYNCED ce qui a ete pousse avec succes
  await markOperationsSynced(operations.map((o) => o.uuid));
  await markLignesSynced(lignes.map((l) => l.uuid));
  await markAnomaliesSynced(anomalies.map((a) => a.uuid));
  await markPhotoMetaSynced(photosMeta.map((p) => p.uuid));

  // Etape 2 : upload des fichiers binaires (best-effort)
  await uploaderPhotosBinaires();"""

    assert old_mark in content, "Bloc de marquage SYNCED introuvable"
    content = content.replace(old_mark, new_mark)

    # 5. Ajouter la fonction uploaderPhotosBinaires a la fin du fichier
    upload_func = '''

/**
 * Upload des fichiers binaires des photos dont la metadonnee est deja
 * remontee (sync_status SYNCED) mais le fichier pas encore (upload_status PENDING).
 *
 * Best-effort : si un upload echoue, on continue ; la photo reste PENDING
 * et sera retentee a la prochaine sync.
 */
async function uploaderPhotosBinaires(): Promise<void> {
  const photos = await getPhotosPendingUpload();
  if (photos.length === 0) return;

  const token = await getItem(STORAGE_KEYS.ACCESS_TOKEN);

  for (const photo of photos) {
    try {
      const uploadUrl = `${API_BASE_URL}/api/sync/photos/${photo.uuid}/upload/`;
      const result = await FileSystem.uploadAsync(uploadUrl, photo.local_uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'fichier',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (result.status === 200) {
        await markPhotoUploaded(photo.uuid);
      }
    } catch (e) {
      console.warn('Upload photo echoue :', photo.uuid, e);
    }
  }
}
'''
    content += upload_func

    sync.write_text(content)
    print("  + syncService.ts modifie avec succes (push meta + upload binaire)")
PYEOF

cd ..

echo ""
echo "=============================================="
echo "COMPLETION 3.3 PARTIELLE TERMINEE."
echo "=============================================="
echo ""
echo "Fait : photoRepository, photoService, PhotosSection, syncService."
echo "RESTE : integrer PhotosSection dans SaisieOperationScreen."
echo "  -> Colle-moi le contenu de src/screens/SaisieOperationScreen.tsx"
echo "     et je te donne les modifications exactes a faire."
echo ""
