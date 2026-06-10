/**
 * Repository des programmes : lecture, recap, cloture locale.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { getDatabase, addCloturePending } from '../database';
import { getItem, STORAGE_KEYS } from '../../storage/secureStorage';
import { Programme, Etape } from '../../types/models';

export interface EtapeAvecPlv extends Etape {
  plv_libelle: string;
  client_raison_sociale: string;
  plv_latitude: number;
  plv_longitude: number;
  op_sync_status: 'PENDING' | 'SYNCED' | null;
}

export interface ProgrammeAvecProgression extends Programme {
  total_etapes: number;
  etapes_visitees: number;
  etapes_echec: number;
}

export interface RecapProgramme {
  total_etapes: number;
  etapes_visitees: number;
  etapes_echec: number;
  nb_operations: number;
  montant_encaisse: number;
  nb_anomalies: number;
}

/**
 * Programmes actifs du livreur : tous les programmes non clôturés, quelle que
 * soit leur date. Un programme reste visible sur le dashboard jusqu'à sa
 * clôture explicite — y compris les programmes de la veille ou antérieurs
 * (livreurs en province, tournées longues).
 */
export async function getProgrammesRecents(): Promise<ProgrammeAvecProgression[]> {
  const db = await getDatabase();
  const userIdStr = await getItem(STORAGE_KEYS.USER_ID);
  const utilisateurId = userIdStr ? parseInt(userIdStr, 10) : null;

  // Sans identifiant livreur, on retourne une liste vide plutôt que de
  // montrer les programmes de tous les livreurs (isolation des données).
  if (!utilisateurId) return [];

  return db.getAllAsync<ProgrammeAvecProgression>(
    `SELECT
        pr.*,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0) AS total_etapes,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'VISITEE') AS etapes_visitees,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'ECHEC') AS etapes_echec
     FROM programme pr
     WHERE pr.is_deleted = 0
       AND pr.utilisateur_id = ?
       AND pr.statut != 'CLOTURE'
     ORDER BY pr.date_programme DESC, pr.type_programme;`,
    [utilisateurId],
  );
}

/**
 * Historique : uniquement les programmes clôturés, du plus récent au plus
 * ancien. Les programmes non clôturés restent sur le dashboard jusqu'à leur
 * clôture explicite.
 */
export async function getTousLesProgrammes(): Promise<ProgrammeAvecProgression[]> {
  const db = await getDatabase();
  const userIdStr = await getItem(STORAGE_KEYS.USER_ID);
  const utilisateurId = userIdStr ? parseInt(userIdStr, 10) : null;
  if (!utilisateurId) return [];
  return db.getAllAsync<ProgrammeAvecProgression>(
    `SELECT
        pr.*,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0) AS total_etapes,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'VISITEE') AS etapes_visitees,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'ECHEC') AS etapes_echec
     FROM programme pr
     WHERE pr.is_deleted = 0
       AND pr.utilisateur_id = ?
       AND pr.statut = 'CLOTURE'
     ORDER BY pr.date_programme DESC, pr.type_programme;`,
    [utilisateurId],
  );
}

export interface OperationRecap {
  plv_libelle: string;
  type_operation: string;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: number; // 0 ou 1 en SQLite
  nb_lignes: number;
}

export async function getOperationsRecapProgramme(
  programmeId: number,
): Promise<OperationRecap[]> {
  const db = await getDatabase();
  return db.getAllAsync<OperationRecap>(
    `SELECT
        p.libelle        AS plv_libelle,
        op.type_operation,
        op.montant_total,
        op.montant_encaisse,
        op.est_encaissee,
        (SELECT COUNT(*) FROM ligne_operation lo
         WHERE lo.operation_uuid = op.uuid AND lo.is_deleted = 0) AS nb_lignes
     FROM operation op
     JOIN etape e ON e.uuid = op.etape_uuid
     JOIN plv p   ON p.id   = e.plv_id
     WHERE e.programme_id = ? AND op.is_deleted = 0
     ORDER BY op.date_heure ASC;`,
    [programmeId],
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
        c.raison_sociale AS client_raison_sociale,
        (SELECT o.sync_status FROM operation o
         WHERE o.etape_uuid = e.uuid AND o.is_deleted = 0
         ORDER BY o.last_modified DESC LIMIT 1) AS op_sync_status
     FROM etape e
     JOIN plv p ON p.id = e.plv_id
     JOIN client c ON c.id = p.client_id
     WHERE e.programme_id = ? AND e.is_deleted = 0
     ORDER BY COALESCE(e.ordre_optimise, e.ordre_prevu);`,
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

  const etapes = await db.getFirstAsync<{ total: number; visitees: number; echec: number }>(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN statut_visite = 'VISITEE' THEN 1 ELSE 0 END) AS visitees,
        SUM(CASE WHEN statut_visite = 'ECHEC'   THEN 1 ELSE 0 END) AS echec
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
    etapes_echec: etapes?.echec ?? 0,
    nb_operations: ops?.nb ?? 0,
    montant_encaisse: ops?.montant ?? 0,
    nb_anomalies: anomalies?.n ?? 0,
  };
}

/**
 * Supprime physiquement les programmes CLOTURE plus vieux que daysToKeep jours
 * et toutes leurs données dépendantes (étapes, opérations, photos…).
 * Supprime aussi les fichiers photo du disque.
 * N'efface jamais les données PENDING non synchronisées.
 */
export async function purgerDonneesAnciennes(daysToKeep = 90): Promise<void> {
  const db = await getDatabase();

  // 1. Identifier les programmes éligibles à la purge
  const oldProgrammes = await db.getAllAsync<{ id: number; uuid: string }>(
    `SELECT id, uuid FROM programme
     WHERE statut = 'CLOTURE'
       AND is_deleted = 0
       AND date(date_programme) < date('now', ? || ' days')
       AND id NOT IN (
         SELECT DISTINCT e.programme_id FROM etape e
         JOIN operation o ON o.etape_uuid = e.uuid
         WHERE o.sync_status = 'PENDING'
       );`,
    [`-${daysToKeep}`],
  );

  if (oldProgrammes.length === 0) return;

  const progIds   = oldProgrammes.map((p) => p.id);
  const progUuids = oldProgrammes.map((p) => p.uuid);
  const ph        = (n: number) => Array(n).fill('?').join(',');

  // 2. Collecter les URI des photos pour suppression fichier
  const photoRows = await db.getAllAsync<{ local_uri: string }>(
    `SELECT p.local_uri FROM photo p
     WHERE (
       p.operation_uuid IN (
         SELECT o.uuid FROM operation o
         JOIN etape e ON e.uuid = o.etape_uuid
         WHERE e.programme_id IN (${ph(progIds.length)})
       )
       OR p.anomalie_uuid IN (
         SELECT a.uuid FROM anomalie a
         WHERE a.programme_uuid IN (${ph(progUuids.length)})
       )
     )`,
    [...progIds, ...progUuids],
  );

  // 3. Supprimer en cascade dans l'ordre des dépendances (FK)
  await db.withTransactionAsync(async () => {
    // photos
    await db.runAsync(
      `DELETE FROM photo WHERE operation_uuid IN (
         SELECT o.uuid FROM operation o
         JOIN etape e ON e.uuid = o.etape_uuid
         WHERE e.programme_id IN (${ph(progIds.length)})
       ) OR anomalie_uuid IN (
         SELECT a.uuid FROM anomalie a WHERE a.programme_uuid IN (${ph(progUuids.length)})
       )`,
      [...progIds, ...progUuids],
    );
    // lignes opération
    await db.runAsync(
      `DELETE FROM ligne_operation WHERE operation_uuid IN (
         SELECT o.uuid FROM operation o
         JOIN etape e ON e.uuid = o.etape_uuid
         WHERE e.programme_id IN (${ph(progIds.length)})
       )`,
      progIds,
    );
    // opérations
    await db.runAsync(
      `DELETE FROM operation WHERE etape_uuid IN (
         SELECT uuid FROM etape WHERE programme_id IN (${ph(progIds.length)})
       )`,
      progIds,
    );
    // anomalies
    await db.runAsync(
      `DELETE FROM anomalie WHERE programme_uuid IN (${ph(progUuids.length)})`,
      progUuids,
    );
    // lignes programme
    await db.runAsync(
      `DELETE FROM ligne_programme WHERE etape_id IN (
         SELECT id FROM etape WHERE programme_id IN (${ph(progIds.length)})
       )`,
      progIds,
    );
    // étapes
    await db.runAsync(
      `DELETE FROM etape WHERE programme_id IN (${ph(progIds.length)})`,
      progIds,
    );
    // programmes
    await db.runAsync(
      `DELETE FROM programme WHERE id IN (${ph(progIds.length)})`,
      progIds,
    );
  });

  // 4. Supprimer les fichiers photo du disque (best-effort, hors transaction)
  for (const { local_uri } of photoRows) {
    await FileSystem.deleteAsync(local_uri, { idempotent: true });
  }
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
