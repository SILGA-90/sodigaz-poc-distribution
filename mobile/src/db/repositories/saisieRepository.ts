/**
 * Repository pour la saisie d'opération terrain.
 *
 * Ce module fournit les données nécessaires au formulaire de saisie
 * (SaisieOperationScreen) et persiste l'opération en local avec
 * sync_status = 'PENDING'. Il gère aussi le marquage ECHEC d'une étape.
 *
 * *        - COLLECTE : le livreur ramasse des emballages vides (bouteilles
 *          consignées). Les articles E* (Emballage) sont tous les types
 *          d'emballages vides actifs. La collecte est opportuniste : aucun
 *          plan : le livreur saisit ce qu'il a réellement ramassé.
 * - RESTITUTION : le livreur livre du gaz plein (articles G*) selon un
 *          plan établi par mock_x3. Les quantités prévues sont lues depuis
 *          ligne_programme et affichées comme référence dans le formulaire.
 *
 * Un livreur peut rouvrir un
 * formulaire déjà enregistré pour corriger une erreur de saisie avant
 * synchronisation. Si une opération PENDING existe déjà pour cette étape,
 * on la met à jour au lieu d'en créer une nouvelle : évite les doublons.
 *
 * L'opération principale, ses lignes et le
 * changement de statut de l'étape doivent être atomiques. Si l'insert
 * d'une ligne échoue, l'opération entière est annulée : pas d'étape
 * marquée VISITEE sans opération enregistrée.
 *
 * *        On ne peut pas écraser un statut VISITEE par ECHEC. Si le livreur
 * a déjà enregistré une opération et revient marquer ECHEC par erreur,
 * la condition protège l'opération enregistrée.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';
import { Article, TypeOperation, SousTypeCollecte, ModePaiement } from '../../types/models';

export interface ArticleSaisie extends Article {
  quantite_prevue: number | null; // non null si article prévu (restitution)
}

export interface EtapeInfo {
  uuid: string;
  programme_uuid: string;
  type_programme: 'COLLECTE' | 'RESTITUTION';
  plv_libelle: string;
  client_raison_sociale: string;
  plv_latitude: number;
  plv_longitude: number;
}

/** Infos de l'étape (type de programme parent, PLV et ses coordonnées). */
export async function getEtapeInfo(etapeId: number): Promise<EtapeInfo | null> {
  const db = await getDatabase();
  return db.getFirstAsync<EtapeInfo>(
    `SELECT
        e.uuid AS uuid,
        pr.uuid AS programme_uuid,
        pr.type_programme AS type_programme,
        p.libelle AS plv_libelle,
        c.raison_sociale AS client_raison_sociale,
        p.latitude AS plv_latitude,
        p.longitude AS plv_longitude
     FROM etape e
     JOIN programme pr ON pr.id = e.programme_id
     JOIN plv p ON p.id = e.plv_id
     JOIN client c ON c.id = p.client_id
     WHERE e.id = ?;`,
    [etapeId],
  );
}

/**
 * Articles saisissables selon le type de programme :
 *   - RESTITUTION : articles G* (gaz emballé) pré-planifiés, avec quantite_prevue.
 *   - COLLECTE    : tous les emballages vides E* actifs, quantite_prevue = null.
 *     La collecte est opportuniste : le livreur ramasse ce qu'il trouve, sans plan.
 */
export async function getArticlesSaisissables(
  etapeId: number,
  typeProgramme: 'COLLECTE' | 'RESTITUTION',
): Promise<ArticleSaisie[]> {
  const db = await getDatabase();

  if (typeProgramme === 'RESTITUTION') {
    return db.getAllAsync<ArticleSaisie>(
      `SELECT
          pr.*,
          lp.quantite_prevue AS quantite_prevue
       FROM ligne_programme lp
       JOIN article pr ON pr.id = lp.produit_id
       WHERE lp.etape_id = ? AND lp.is_deleted = 0
       ORDER BY pr.libelle;`,
      [etapeId],
    );
  }

  return db.getAllAsync<ArticleSaisie>(
    `SELECT *, NULL AS quantite_prevue
     FROM article
     WHERE actif = 1 AND code_x3 LIKE 'E%'
     ORDER BY libelle;`,
  );
}

export interface LigneSaisie {
  produit_code_x3: string;
  quantite_realisee: number;
  montant_ligne: number;
}

export interface OperationSaisie {
  etape_uuid: string;
  type_operation: TypeOperation;
  sous_type: SousTypeCollecte;
  mode_paiement: ModePaiement;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: boolean;
  latitude?: number | null;
  longitude?: number | null;
  gps_precision?: number | null;
  gps_horodatage?: string | null;
  commentaire: string;
  signature_livreur?: string;
  signature_client?: string;
  nom_signataire_client?: string;
  lignes: LigneSaisie[];
}

/** Opération PENDING existante pour cette étape (pour édition) ? */
export async function getOperationPendingPourEtape(
  etapeUuid: string,
): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ uuid: string }>(
    `SELECT uuid FROM operation
     WHERE etape_uuid = ? AND sync_status = 'PENDING' AND is_deleted = 0
     LIMIT 1;`,
    [etapeUuid],
  );
  return row?.uuid ?? null;
}

/**
 * Enregistre une opération en local (PENDING).
 * Si une opération PENDING existe déjà pour l'étape, on la met à jour
 * (pas de duplication). Marque l'étape comme VISITEE.
 */
export async function enregistrerOperation(data: OperationSaisie): Promise<string> {
  const db = await getDatabase();
  const ts = Date.now();
  const nowIso = new Date().toISOString();
  const lat = data.latitude ?? null;
  const lon = data.longitude ?? null;

  const existant = await getOperationPendingPourEtape(data.etape_uuid);
  const opUuid = existant ?? Crypto.randomUUID();

  await db.withTransactionAsync(async () => {
    if (existant) {
      await db.runAsync('DELETE FROM ligne_operation WHERE operation_uuid = ?;', [opUuid]);
      await db.runAsync(
        `UPDATE operation SET
           type_operation = ?, sous_type = ?, mode_paiement = ?,
           latitude = ?, longitude = ?, gps_precision = ?, gps_horodatage = ?,
           montant_total = ?, montant_encaisse = ?, est_encaissee = ?,
           signature_livreur = ?, signature_client = ?, nom_signataire_client = ?,
           commentaire = ?, date_heure = ?, last_modified = ?
         WHERE uuid = ?;`,
        [
          data.type_operation, data.sous_type ?? null, data.mode_paiement ?? null,
          lat, lon, data.gps_precision ?? null, data.gps_horodatage ?? null,
          data.montant_total, data.montant_encaisse, data.est_encaissee ? 1 : 0,
          data.signature_livreur ?? '', data.signature_client ?? '',
          data.nom_signataire_client ?? '',
          data.commentaire, nowIso, ts, opUuid,
        ],
      );
    } else {
      await db.runAsync(
        `INSERT INTO operation
         (uuid, etape_uuid, type_operation, sous_type, date_heure,
          latitude, longitude, gps_precision, gps_horodatage,
          mode_paiement, montant_total, montant_encaisse,
          est_encaissee, signature_livreur, signature_client, nom_signataire_client,
          commentaire, sync_status, last_modified, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0);`,
        [
          opUuid, data.etape_uuid, data.type_operation, data.sous_type ?? null, nowIso,
          lat, lon, data.gps_precision ?? null, data.gps_horodatage ?? null,
          data.mode_paiement ?? null, data.montant_total, data.montant_encaisse,
          data.est_encaissee ? 1 : 0,
          data.signature_livreur ?? '', data.signature_client ?? '',
          data.nom_signataire_client ?? '', data.commentaire, ts,
        ],
      );
    }

    for (const ligne of data.lignes) {
      if (ligne.quantite_realisee <= 0) continue;
      await db.runAsync(
        `INSERT INTO ligne_operation
         (uuid, operation_uuid, produit_code_x3, quantite_realisee,
          quantite_collectee_vide, quantite_consignee, quantite_deconsignee,
          montant_ligne, sync_status, last_modified, is_deleted)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'PENDING', ?, 0);`,
        [Crypto.randomUUID(), opUuid, ligne.produit_code_x3,
         ligne.quantite_realisee, ligne.montant_ligne, ts],
      );
    }

    await db.runAsync(
      `UPDATE etape SET statut_visite = 'VISITEE', last_modified = ?
       WHERE uuid = ?;`,
      [ts, data.etape_uuid],
    );
  });

  return opUuid;
}

/**
 * Marque une étape comme ECHEC (visite impossible).
 * N'écrase pas un statut VISITEE déjà enregistré.
 */
export async function marquerEtapeEchec(etapeUuid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE etape SET statut_visite = 'ECHEC', last_modified = ?
     WHERE uuid = ? AND statut_visite = 'A_VISITER';`,
    [Date.now(), etapeUuid],
  );
}
