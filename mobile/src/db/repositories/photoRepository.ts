/**
 * Repository des photos.
 * Une photo est rattachee soit a une operation, soit a une anomalie.
 *
 * Invariant de stockage : local_uri pointe TOUJOURS vers PHOTOS_DIR
 * (documentDirectory/photos/), jamais vers un répertoire cache.
 * Les répertoires cache Android peuvent être vidés par l'OS à tout moment.
 */
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { getDatabase } from '../database';

/**
 * Répertoire persistant pour les photos.
 * documentDirectory survit aux vidages de cache et aux redémarrages.
 * Il est supprimé uniquement lors d'une désinstallation de l'app.
 */
export const PHOTOS_DIR = FileSystem.documentDirectory! + 'photos/';

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
  upload_status: 'PENDING' | 'DONE' | 'FILE_LOST';
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

/**
 * Marque une photo dont le fichier local a été perdu (cache Android vidé).
 * Distinct de DONE : le binaire n'est PAS sur le serveur.
 * La métadonnée est conservée pour traçabilité.
 */
export async function markPhotoFileLost(uuid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE photo SET upload_status = 'FILE_LOST' WHERE uuid = ?;`, [uuid]);
}

async function updatePhotoLocalUri(uuid: string, newUri: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE photo SET local_uri = ? WHERE uuid = ?;`, [newUri, uuid]);
}

export async function deletePhoto(uuid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE photo SET is_deleted = 1 WHERE uuid = ?;`, [uuid]);
}

/**
 * Répare les local_uri pointant vers le cache Android (créées avant le correctif).
 * Appelé une seule fois au démarrage, en tâche de fond.
 *
 * Pour chaque photo PENDING :
 *   - fichier présent dans le cache → déplacé vers PHOTOS_DIR, local_uri mis à jour
 *   - fichier absent             → marqué FILE_LOST (impossible à récupérer)
 */
export async function repairCachePhotoUris(): Promise<void> {
  const db = await getDatabase();
  const photos = await db.getAllAsync<{ uuid: string; local_uri: string }>(
    `SELECT uuid, local_uri FROM photo
     WHERE upload_status = 'PENDING' AND is_deleted = 0;`,
  );

  if (photos.length === 0) return;

  await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });

  for (const photo of photos) {
    if (photo.local_uri.startsWith(PHOTOS_DIR)) continue; // déjà au bon endroit

    const info = await FileSystem.getInfoAsync(photo.local_uri);
    if (info.exists) {
      const filename = photo.local_uri.split('/').pop()!;
      const persistentUri = PHOTOS_DIR + filename;
      await FileSystem.copyAsync({ from: photo.local_uri, to: persistentUri });
      await FileSystem.deleteAsync(photo.local_uri, { idempotent: true });
      await updatePhotoLocalUri(photo.uuid, persistentUri);
    } else {
      await markPhotoFileLost(photo.uuid);
      console.warn('[repairCachePhotoUris] fichier introuvable, marqué FILE_LOST :', photo.uuid, photo.local_uri);
    }
  }
}
