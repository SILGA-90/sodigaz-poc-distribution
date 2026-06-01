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
