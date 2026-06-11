/**
 * Repository des photos terrain.
 *
 * Ce module gère le cycle de vie des photos enregistrées par le livreur
 * (capture -> stockage local -> sync métadonnées -> upload binaire).
 *
 * Une photo a deux statuts indépendants :
 *          - sync_status  : PENDING -> SYNCED  (métadonnées JSON dans le push)
 *          - upload_status: PENDING -> DONE / FILE_LOST  (binaire via /photos/<uuid>/upload/)
 *
 * Les métadonnées (uuid, type, horodatage, GPS)
 * sont poussées dans le payload JSON standard de sync. Le binaire est
 * uploadé séparément en multipart. Les deux étapes peuvent échouer
 * indépendamment : sync_status = SYNCED mais upload_status = PENDING
 * signifie que le serveur connaît la photo mais n'a pas encore le fichier.
 *
 * Les fichiers persistants ne
 * doivent pas être dans le cache Android (getCacheDir()), qui peut être
 * vidé par l'OS. documentDirectory survit aux vidanges de cache et aux
 * redémarrages. Il est supprimé uniquement à la désinstallation de l'app.
 *
 * Les photos créées avant la mise en place de
 * PHOTOS_DIR pointaient vers le cache. Cette fonction de migration one-shot
 * déplace les fichiers existants et met à jour les local_uri en base.
 * Appelée au démarrage en fire-and-forget depuis RootNavigator.
 *
 * Un fichier perdu (cache vidé) ne doit pas
 * être marqué DONE : le binaire n'est pas sur le serveur. FILE_LOST
 * permet au superviseur de savoir qu'une photo a été signalée mais son
 * fichier est perdu, sans masquer le problème.
 *
 * Invariant
 * du modèle de données Django (CheckConstraint + clean()). Respecté
 * côté mobile dans insertPhoto : on passe toujours l'un à null.
 */
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { getDatabase } from '../database';
import logger from '../../services/logger';

/** Répertoire persistant pour les photos (documentDirectory, jamais le cache). */
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

/** Photos dont les métadonnées JSON n'ont pas encore été envoyées au serveur. */
export async function getPhotosPendingMeta(): Promise<PhotoLocale[]> {
  const db = await getDatabase();
  return db.getAllAsync<PhotoLocale>(
    `SELECT * FROM photo WHERE sync_status = 'PENDING' AND is_deleted = 0;`,
  );
}

/** Photos dont les métadonnées sont SYNCED mais le binaire n'a pas encore été uploadé. */
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
 * Appelée une seule fois au démarrage (RootNavigator), en tâche de fond.
 *
 * Pour chaque photo PENDING :
 *   - fichier présent dans le cache -> déplacé vers PHOTOS_DIR, local_uri mis à jour
 *   - fichier absent             -> marqué FILE_LOST (impossible à récupérer)
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
      logger.warn('[repairCachePhotoUris] fichier introuvable, marqué FILE_LOST :', photo.uuid, photo.local_uri);
    }
  }
}
