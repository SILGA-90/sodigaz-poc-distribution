/**
 * Repository des programmes : lecture, recap, cloture locale.
 */
import { getDatabase, addCloturePending } from '../database';
import { getItem, STORAGE_KEYS } from '../../storage/secureStorage';
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
  etapes_echec: number;
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
  const userIdStr = await getItem(STORAGE_KEYS.USER_ID);
  const utilisateurId = userIdStr ? parseInt(userIdStr, 10) : null;

  if (utilisateurId) {
    return db.getAllAsync<ProgrammeAvecProgression>(
      `SELECT
          pr.*,
          (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0) AS total_etapes,
          (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'VISITEE') AS etapes_visitees,
          (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'ECHEC') AS etapes_echec
       FROM programme pr
       WHERE pr.is_deleted = 0
         AND pr.utilisateur_id = ?
         AND date(pr.date_programme) = date('now')
       ORDER BY pr.type_programme;`,
      [utilisateurId],
    );
  }

  // Fallback si l'id n'est pas encore en cache (premier lancement avant login complet)
  return db.getAllAsync<ProgrammeAvecProgression>(
    `SELECT
        pr.*,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0) AS total_etapes,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'VISITEE') AS etapes_visitees,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'ECHEC') AS etapes_echec
     FROM programme pr
     WHERE pr.is_deleted = 0
       AND date(pr.date_programme) = date('now')
     ORDER BY pr.type_programme;`,
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
