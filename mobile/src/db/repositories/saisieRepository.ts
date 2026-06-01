/**
 * Repository pour la saisie d'operation.
 * Fournit les donnees du formulaire et enregistre l'operation en local.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';
import { Produit, TypeOperation, SousTypeCollecte, ModePaiement } from '../../types/models';

export interface ProduitSaisie extends Produit {
  quantite_prevue: number | null; // non null si produit prevu (restitution)
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

/**
 * Infos de l'etape (type de programme parent, PLV et ses coordonnees).
 */
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
 * Produits saisissables :
 *   - RESTITUTION : produits prevus (lignes_programme) avec quantite prevue.
 *   - COLLECTE : tous les produits actifs, quantite_prevue = null.
 */
export async function getProduitsSaisissables(
  etapeId: number,
  typeProgramme: 'COLLECTE' | 'RESTITUTION',
): Promise<ProduitSaisie[]> {
  const db = await getDatabase();

  if (typeProgramme === 'RESTITUTION') {
    return db.getAllAsync<ProduitSaisie>(
      `SELECT
          pr.*,
          lp.quantite_prevue AS quantite_prevue
       FROM ligne_programme lp
       JOIN produit pr ON pr.id = lp.produit_id
       WHERE lp.etape_id = ? AND lp.is_deleted = 0
       ORDER BY pr.libelle;`,
      [etapeId],
    );
  }

  return db.getAllAsync<ProduitSaisie>(
    `SELECT *, NULL AS quantite_prevue
     FROM produit
     WHERE actif = 1
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

/**
 * Operation PENDING existante pour cette etape (pour edition) ?
 */
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
 * Enregistre une operation en local (PENDING).
 * Si une operation PENDING existe deja pour l'etape, on la met a jour
 * (pas de duplication). Marque l'etape comme VISITEE.
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
