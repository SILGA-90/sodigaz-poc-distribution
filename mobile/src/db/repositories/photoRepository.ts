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
