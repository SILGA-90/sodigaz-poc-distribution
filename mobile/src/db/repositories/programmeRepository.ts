/**
 * Repository des programmes : lecture, récapitulatif, clôture locale, purge.
 *
 * Ce module fournit les fonctions d'accès aux programmes, étapes et
 * opérations pour les écrans DashboardScreen, ProgrammeScreen et
 * ClotureScreen. Il gère aussi la clôture locale et la purge des données
 * anciennes.
 *
 * Un programme
 * reste actif sur le dashboard jusqu'à sa clôture explicite : même s'il
 * date de la veille (livreurs en province, tournées longues). Filtrer par
 * date_programme = aujourd'hui laisserait le livreur sans programme visible
 * le lendemain matin d'une tournée non clôturée.
 *
 * L'ordre
 * optimisé par l'heuristique du plus proche voisin remplace l'ordre prévu
 * si disponible. Si le circuit n'a pas encore été calculé (ordre_optimise
 * null), on tombe sur l'ordre prévu. Voir CLAUDE.md §5.
 *
 * La clôture est d'abord
 * locale : le statut CLOTURE est écrit dans SQLite, puis l'UUID est mis
 * dans une file d'attente (sync_meta). Le push de clôture se fait en tête
 * de cycle dans syncAll() (pushClotures -> pull -> push). Stocker la file
 * dans sync_meta et non dans la table programme protège la clôture d'un
 * écrasement par un pull ultérieur (voir database.ts).
 *
 * On ne supprime jamais des
 * opérations non synchronisées, même si le programme est ancien. Un
 * livreur sans réseau depuis plusieurs jours doit pouvoir retrouver ses
 * saisies au retour du réseau. La purge ne touche que les données
 * confirmées (sync_status ≠ PENDING) et clôturées depuis plus de 90 jours.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { getDatabase, addCloturePending } from '../database';
import { getItem, STORAGE_KEYS } from '../../storage/secureStorage';
import { Programme, Etape } from '../../types/models';

export interface EtapeAvecPlv extends Etape {
  plv_code: string | null;
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
  montant_total: number;
  montant_encaisse: number;
  nb_anomalies: number;
}

/**
 * Programmes actifs du livreur : tous les programmes non clôturés, quelle que
 * soit leur date. Un programme reste visible sur le dashboard jusqu'à sa
 * clôture explicite : y compris les programmes de la veille ou antérieurs
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
  operation_uuid: string;
  plv_code: string | null;
  plv_libelle: string;
  plv_adresse: string | null;
  client_raison_sociale: string;
  type_operation: string;
  date_heure: string;
  mode_paiement: string | null;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: number; // 0 ou 1 en SQLite
}

export async function getOperationsRecapProgramme(
  programmeId: number,
): Promise<OperationRecap[]> {
  const db = await getDatabase();
  return db.getAllAsync<OperationRecap>(
    `SELECT
        op.uuid                AS operation_uuid,
        p.code_plv             AS plv_code,
        p.libelle              AS plv_libelle,
        p.adresse              AS plv_adresse,
        c.raison_sociale       AS client_raison_sociale,
        op.type_operation,
        op.date_heure,
        op.mode_paiement,
        op.montant_total,
        op.montant_encaisse,
        op.est_encaissee
     FROM operation op
     JOIN etape e  ON e.uuid  = op.etape_uuid
     JOIN plv p    ON p.id    = e.plv_id
     JOIN client c ON c.id    = p.client_id
     WHERE e.programme_id = ? AND op.is_deleted = 0
     ORDER BY op.date_heure ASC;`,
    [programmeId],
  );
}

export interface LigneOperationRecap {
  operation_uuid: string;
  libelle: string;
  type_emballage: string;
  quantite_realisee: number;
  montant_ligne: number;
}

export async function getLignesOperationsRecap(
  programmeId: number,
): Promise<LigneOperationRecap[]> {
  const db = await getDatabase();
  return db.getAllAsync<LigneOperationRecap>(
    `SELECT
        lo.operation_uuid,
        ar.libelle,
        ar.type_emballage,
        lo.quantite_realisee,
        lo.montant_ligne
     FROM ligne_operation lo
     JOIN operation op ON op.uuid    = lo.operation_uuid
     JOIN etape e      ON e.uuid     = op.etape_uuid
     JOIN article ar   ON ar.code_x3 = lo.produit_code_x3
     WHERE e.programme_id = ?
       AND lo.is_deleted = 0
       AND lo.quantite_realisee > 0
     ORDER BY op.date_heure ASC, ar.libelle ASC;`,
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
        p.code_plv AS plv_code,
        p.libelle  AS plv_libelle,
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

/** Récapitulatif d'un programme pour l'écran de clôture. */
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

  const ops = await db.getFirstAsync<{ nb: number; montant: number; montant_total: number }>(
    `SELECT
        COUNT(DISTINCT o.uuid)           AS nb,
        COALESCE(SUM(o.montant_encaisse), 0) AS montant,
        COALESCE(SUM(o.montant_total),    0) AS montant_total
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
    montant_total: ops?.montant_total ?? 0,
    montant_encaisse: ops?.montant ?? 0,
    nb_anomalies: anomalies?.n ?? 0,
  };
}

/**
 * Supprime physiquement les programmes CLOTURE plus vieux que daysToKeep jours
 * et toutes leurs données dépendantes (étapes, opérations, photos...).
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
 * Clôture un programme localement : statut CLOTURE + heure de fin locale,
 * et inscription dans la file d'attente de remontée (sync_meta).
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
