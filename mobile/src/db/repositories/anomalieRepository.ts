/**
 * Repository des anomalies : création locale et lecture.
 *
 * Ce module expose les fonctions de création et de lecture des anomalies
 * signalées par le livreur sur le terrain. Les anomalies sont créées avec
 * sync_status = 'PENDING' et remontées au serveur par syncService.ts.
 *
 * Le livreur sur le terrain n'est pas
 * en mesure d'évaluer la gravité technique d'une anomalie (fuite, bris,
 * problème de sécurité). La gravité par défaut 'MOYENNE' est conservatrice
 * : le superviseur la reclassifie après examen côté web.
 *
 * Une anomalie signalée sur le terrain
 * est toujours ouverte jusqu'à traitement côté supervision. Le cycle
 * OUVERTE -> EN_TRAITEMENT -> RESOLUE est géré uniquement côté serveur.
 *
 * WHY (uuid généré par Crypto.randomUUID()) : Les anomalies font partie des
 * données "ascendantes" (créées sur le mobile, poussées au serveur). Leur
 * UUID est fourni par le mobile au moment du push : c'est l'invariant
 * de synchronisation (voir CLAUDE.md §4). Le serveur accepte et stocke
 * cet UUID sans en générer un nouveau.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';

export interface AnomalieSaisie {
  programme_uuid: string;
  plv_id: number | null;
  type_anomalie: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
}

export async function creerAnomalie(data: AnomalieSaisie): Promise<string> {
  const db = await getDatabase();
  const uuid = Crypto.randomUUID();
  const ts = Date.now();
  // gravite = 'MOYENNE' par défaut ; le superviseur la reclassifie côté serveur.
  await db.runAsync(
    `INSERT INTO anomalie
     (uuid, programme_uuid, plv_id, type_anomalie, gravite, description, statut,
      date_heure, latitude, longitude, sync_status, last_modified, is_deleted)
     VALUES (?, ?, ?, ?, 'MOYENNE', ?, 'OUVERTE', ?, ?, ?, 'PENDING', ?, 0);`,
    [
      uuid, data.programme_uuid, data.plv_id, data.type_anomalie,
      data.description, new Date().toISOString(), data.latitude, data.longitude, ts,
    ],
  );
  return uuid;
}

export interface AnomalieLocale {
  uuid: string;
  type_anomalie: string;
  gravite: 'FAIBLE' | 'MOYENNE' | 'ELEVEE';
  description: string;
  date_heure: string;
  sync_status: string;
  statut: string;
}

export async function getAnomaliesDuProgramme(programmeUuid: string): Promise<AnomalieLocale[]> {
  const db = await getDatabase();
  return db.getAllAsync<AnomalieLocale>(
    `SELECT uuid, type_anomalie, gravite, description, date_heure, sync_status, statut
     FROM anomalie WHERE programme_uuid = ? AND is_deleted = 0 ORDER BY date_heure DESC;`,
    [programmeUuid],
  );
}

export async function countAnomaliesProgramme(programmeUuid: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM anomalie WHERE programme_uuid = ? AND is_deleted = 0;`,
    [programmeUuid],
  );
  return row?.n ?? 0;
}
