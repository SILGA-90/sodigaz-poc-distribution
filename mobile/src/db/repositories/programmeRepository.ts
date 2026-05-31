/**
 * Repository des programmes : acces en lecture aux programmes locaux.
 */
import { getDatabase } from '../database';
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
}

/**
 * Programmes des 7 derniers jours, avec leur progression (etapes visitees).
 * On ne filtre pas strictement sur "aujourd'hui" pour eviter qu'un programme
 * genere un autre jour n'apparaisse pas pendant le developpement.
 */
export async function getProgrammesRecents(): Promise<ProgrammeAvecProgression[]> {
  const db = await getDatabase();
  return db.getAllAsync<ProgrammeAvecProgression>(
    `SELECT
        pr.*,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0) AS total_etapes,
        (SELECT COUNT(*) FROM etape e WHERE e.programme_id = pr.id AND e.is_deleted = 0 AND e.statut_visite = 'VISITEE') AS etapes_visitees
     FROM programme pr
     WHERE pr.is_deleted = 0
       AND date(pr.date_programme) >= date('now', '-7 days')
     ORDER BY pr.date_programme DESC, pr.type_programme;`,
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
     ORDER BY e.ordre_prevu;`,
    [programmeId],
  );
}
