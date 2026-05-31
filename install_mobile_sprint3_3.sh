#!/bin/bash
# =============================================================================
# Sprint 3.3 du mobile : photos (capture + compression + stockage + upload)
#   - expo-camera + expo-image-picker (galerie) + expo-image-manipulator
#   - enregistrement local Photo (PENDING) rattache a l'operation
#   - push metadonnees (deja gere serveur) + upload binaire dedie
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_3.sh
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

echo "=== Installation des dependances photo ==="
npx expo install expo-image-picker expo-image-manipulator expo-file-system

echo ""
echo "=== Mise a jour du schema SQLite (table photo) ==="

# On ajoute la table photo au schema. Comme la base existe deja avec
# user_version=1, on incremente a 2 et on ajoute une migration.

python3 << 'PYEOF'
from pathlib import Path

schema = Path("src/db/schema.ts")
content = schema.read_text()

# Passer la version a 2
content = content.replace(
    "export const SCHEMA_VERSION = 1;",
    "export const SCHEMA_VERSION = 2;",
)

# Ajouter la table photo dans le SQL de creation (avant les index)
if "CREATE TABLE IF NOT EXISTS photo" not in content:
    content = content.replace(
        "-- Index utiles",
        """CREATE TABLE IF NOT EXISTS photo (
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

-- Index utiles""",
    )
    # Ajouter index photo
    content = content.replace(
        "CREATE INDEX IF NOT EXISTS idx_anomalie_programme ON anomalie(programme_uuid);",
        "CREATE INDEX IF NOT EXISTS idx_anomalie_programme ON anomalie(programme_uuid);\n"
        "CREATE INDEX IF NOT EXISTS idx_photo_operation ON photo(operation_uuid);\n"
        "CREATE INDEX IF NOT EXISTS idx_photo_sync ON photo(sync_status, upload_status);",
    )

schema.write_text(content)
print("  + table photo ajoutee au schema (version 2)")

# Ajouter la migration dans database.ts
db = Path("src/db/database.ts")
dbcontent = db.read_text()

# Ajouter une migration de v1 a v2 dans getDatabase
if "CREATE TABLE IF NOT EXISTS photo" not in dbcontent:
    dbcontent = dbcontent.replace(
        "    // Migrations futures : ajouter ici des blocs if (currentVersion < N)",
        """    // Migrations futures : ajouter ici des blocs if (currentVersion < N)
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
    await db.execAsync('PRAGMA user_version = 2;');""",
    )
    db.write_text(dbcontent)
    print("  + migration v1->v2 ajoutee a database.ts")
PYEOF

echo ""
echo "=== Creation du repository et du service photo ==="

# -----------------------------------------------------------------------------
# photoRepository.ts
# -----------------------------------------------------------------------------
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

echo "  + photoRepository.ts cree"

# -----------------------------------------------------------------------------
# photoService.ts : capture + compression
# -----------------------------------------------------------------------------
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

  // Recuperer la taille du fichier compresse
  const info = await FileSystem.getInfoAsync(result.uri);
  const taille = info.exists && 'size' in info ? info.size : 0;

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

echo "  + photoService.ts cree"

# Creer le dossier services s'il n'existe pas
mkdir -p src/services

# -----------------------------------------------------------------------------
# Ajout au syncService : push des metadonnees photo + upload binaire
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

sync = Path("src/sync/syncService.ts")
content = sync.read_text()

# Importer le repository photo et FileSystem
content = content.replace(
    "import {\n"
    "  getPendingOperations,\n"
    "  getPendingLignesOperation,\n"
    "  getPendingAnomalies,\n"
    "  markOperationsSynced,\n"
    "  markLignesSynced,\n"
    "  markAnomaliesSynced,\n"
    "} from '../db/repositories/operationRepository';",
    "import {\n"
    "  getPendingOperations,\n"
    "  getPendingLignesOperation,\n"
    "  getPendingAnomalies,\n"
    "  markOperationsSynced,\n"
    "  markLignesSynced,\n"
    "  markAnomaliesSynced,\n"
    "} from '../db/repositories/operationRepository';\n"
    "import {\n"
    "  getPhotosPendingMeta,\n"
    "  getPhotosPendingUpload,\n"
    "  markPhotoMetaSynced,\n"
    "  markPhotoUploaded,\n"
    "} from '../db/repositories/photoRepository';\n"
    "import * as FileSystem from 'expo-file-system';\n"
    "import { API_BASE_URL } from '../config/api';\n"
    "import { getItem, STORAGE_KEYS } from '../storage/secureStorage';",
)

# Ajouter le push des metadonnees photo dans le payload du push.
# On ajoute une cle "photo" dans changes.
content = content.replace(
    "      anomalie: {\n"
    "        created: anomalies.map((a) => ({\n"
    "          uuid: a.uuid,\n"
    "          programme_uuid: a.programme_uuid,\n"
    "          plv_id: a.plv_id,\n"
    "          type_anomalie: a.type_anomalie,\n"
    "          gravite: a.gravite,\n"
    "          description: a.description,\n"
    "          statut: a.statut,\n"
    "          date_heure: a.date_heure,\n"
    "          latitude: a.latitude,\n"
    "          longitude: a.longitude,\n"
    "        })),\n"
    "        updated: [],\n"
    "        deleted: [],\n"
    "      },\n"
    "    },\n"
    "  };",
    "      anomalie: {\n"
    "        created: anomalies.map((a) => ({\n"
    "          uuid: a.uuid,\n"
    "          programme_uuid: a.programme_uuid,\n"
    "          plv_id: a.plv_id,\n"
    "          type_anomalie: a.type_anomalie,\n"
    "          gravite: a.gravite,\n"
    "          description: a.description,\n"
    "          statut: a.statut,\n"
    "          date_heure: a.date_heure,\n"
    "          latitude: a.latitude,\n"
    "          longitude: a.longitude,\n"
    "        })),\n"
    "        updated: [],\n"
    "        deleted: [],\n"
    "      },\n"
    "      photo: {\n"
    "        created: photosMeta.map((p) => ({\n"
    "          uuid: p.uuid,\n"
    "          operation_uuid: p.operation_uuid,\n"
    "          anomalie_uuid: p.anomalie_uuid,\n"
    "          type_photo: p.type_photo,\n"
    "          date_heure: p.date_heure,\n"
    "          latitude: p.latitude,\n"
    "          longitude: p.longitude,\n"
    "          taille_octets: p.taille_octets,\n"
    "        })),\n"
    "        updated: [],\n"
    "        deleted: [],\n"
    "      },\n"
    "    },\n"
    "  };",
)

# Charger les photos meta pending au debut de push()
content = content.replace(
    "  const operations = await getPendingOperations();\n"
    "  const lignes = await getPendingLignesOperation();\n"
    "  const anomalies = await getPendingAnomalies();",
    "  const operations = await getPendingOperations();\n"
    "  const lignes = await getPendingLignesOperation();\n"
    "  const anomalies = await getPendingAnomalies();\n"
    "  const photosMeta = await getPhotosPendingMeta();",
)

# Adapter la condition "rien a pousser"
content = content.replace(
    "  if (operations.length === 0 && lignes.length === 0 && anomalies.length === 0) {\n"
    "    return { success: true, pushed: empty };\n"
    "  }",
    "  if (operations.length === 0 && lignes.length === 0 && anomalies.length === 0 && photosMeta.length === 0) {\n"
    "    // Meme si rien a pousser en meta, il peut rester des uploads binaires en attente\n"
    "    await uploaderPhotosBinaires();\n"
    "    return { success: true, pushed: empty };\n"
    "  }",
)

# Apres le marquage SYNCED, marquer les photos meta + lancer les uploads
content = content.replace(
    "  await markOperationsSynced(operations.map((o) => o.uuid));\n"
    "  await markLignesSynced(lignes.map((l) => l.uuid));\n"
    "  await markAnomaliesSynced(anomalies.map((a) => a.uuid));",
    "  await markOperationsSynced(operations.map((o) => o.uuid));\n"
    "  await markLignesSynced(lignes.map((l) => l.uuid));\n"
    "  await markAnomaliesSynced(anomalies.map((a) => a.uuid));\n"
    "  await markPhotoMetaSynced(photosMeta.map((p) => p.uuid));\n\n"
    "  // Etape 2 : upload des fichiers binaires (best-effort)\n"
    "  await uploaderPhotosBinaires();",
)

# Ajouter la fonction uploaderPhotosBinaires a la fin du fichier
upload_func = '''

/**
 * Upload des fichiers binaires des photos dont la metadonnee est deja
 * remontee (sync_status SYNCED) mais le fichier pas encore (upload_status PENDING).
 *
 * Best-effort : si un upload echoue, on continue avec les autres ;
 * la photo restera PENDING et sera retentee a la prochaine sync.
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
      // Si != 200, on laisse PENDING : retry au prochain cycle
    } catch (e) {
      // Erreur reseau : on laisse PENDING, retry au prochain cycle
      console.warn('Upload photo echoue :', photo.uuid, e);
    }
  }
}
'''
content += upload_func
sync.write_text(content)
print("  + push photo + upload binaire ajoutes au syncService")
PYEOF

# -----------------------------------------------------------------------------
# Composant de gestion des photos dans le formulaire de saisie
# -----------------------------------------------------------------------------
cat > src/components/PhotosSection.tsx << 'TSEOF'
/**
 * Section de gestion des photos d'une operation.
 *
 * Permet de prendre une photo (camera) ou d'en choisir une (galerie),
 * les compresse, les stocke en local, et les affiche en miniatures.
 *
 * Les photos sont rattachees a une operation par son uuid. Comme l'operation
 * n'est creee qu'a l'enregistrement, ce composant accumule d'abord les photos
 * en memoire, et le parent les persiste apres avoir cree l'operation.
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

echo "  + PhotosSection.tsx cree"

# -----------------------------------------------------------------------------
# Integration dans SaisieOperationScreen
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

saisie = Path("src/screens/SaisieOperationScreen.tsx")
content = saisie.read_text()

# Importer PhotosSection + le repository photo + le type
content = content.replace(
    "import SignaturePad from '../components/SignaturePad';",
    "import SignaturePad from '../components/SignaturePad';\n"
    "import PhotosSection, { PhotoEnAttente } from '../components/PhotosSection';\n"
    "import { ajouterPhotoOperation } from '../db/repositories/photoRepository';",
)

# Ajouter le state photos
content = content.replace(
    "  const [padVisible, setPadVisible] = useState<null | 'LIVREUR' | 'CLIENT'>(null);",
    "  const [padVisible, setPadVisible] = useState<null | 'LIVREUR' | 'CLIENT'>(null);\n"
    "  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);",
)

# Apres enregistrerOperation (qui retourne l'uuid), persister les photos.
# On capture l'uuid retourne.
content = content.replace(
    "      await enregistrerOperation({",
    "      const opUuid = await enregistrerOperation({",
)

# Ajouter la persistance des photos juste apres l'appel (avant le Alert succes)
content = content.replace(
    "      Alert.alert(\n"
    "        'Operation enregistree',\n"
    "        'L\\'operation est enregistree localement. Elle sera remontee a la prochaine synchronisation.',\n"
    "        [{ text: 'OK', onPress: () => navigation.goBack() }],\n"
    "      );",
    "      // Persister les photos rattachees a l'operation\n"
    "      for (const ph of photos) {\n"
    "        await ajouterPhotoOperation(\n"
    "          opUuid, ph.uri, ph.type_photo, ph.tailleOctets, null, null,\n"
    "        );\n"
    "      }\n\n"
    "      Alert.alert(\n"
    "        'Operation enregistree',\n"
    "        `L'operation${photos.length > 0 ? ' et ' + photos.length + ' photo(s)' : ''} enregistree(s) localement. Remontee a la prochaine synchronisation.`,\n"
    "        [{ text: 'OK', onPress: () => navigation.goBack() }],\n"
    "      );",
)

# Ajouter la section Photos dans le rendu, juste apres la section Signatures
content = content.replace(
    "      <Text style={styles.sectionTitle}>Commentaire (optionnel)</Text>",
    "      <Text style={styles.sectionTitle}>Photos</Text>\n"
    "      <PhotosSection photos={photos} onChange={setPhotos} />\n\n"
    "      <Text style={styles.sectionTitle}>Commentaire (optionnel)</Text>",
)

saisie.write_text(content)
print("  + PhotosSection integree au formulaire de saisie")
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.3 - PHOTOS TERMINEES."
echo "=============================================="
echo ""
echo "IMPORTANT : la base SQLite passe en version 2 (nouvelle table photo)."
echo "La migration s'applique automatiquement au prochain lancement."
echo ""
echo "Test :"
echo "  1. Recharge l'app : npx expo start --clear puis reload."
echo "  2. Ouvre une etape, remplis les quantites."
echo "  3. Section Photos : choisis un type (Bordereau/Livraison/Etat PLV),"
echo "     puis 'Prendre une photo' ou 'Galerie'."
echo "     (Expo Go demandera la permission camera/galerie la 1ere fois.)"
echo "  4. La miniature apparait. Tu peux en ajouter plusieurs."
echo "  5. Enregistre l'operation, synchronise."
echo "  6. Verifie sur la supervision web / admin Django :"
echo "     - la metadonnee photo est remontee (table Photos)"
echo "     - le fichier est uploade (champ fichier rempli, ouvrable)"
echo ""
echo "Le mode offline marche aussi : prends une photo en mode avion,"
echo "elle sera uploadee automatiquement au retour du reseau."
echo ""
