/**
 * Repository des operations : creation locale, lecture des PENDING, marquage SYNCED.
 *
 * Les operations sont creees sur le mobile (hors ligne possible) avec
 * sync_status = 'PENDING'. Le service de push les remonte au serveur et
 * les passe a 'SYNCED'.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';
import { Operation, LigneOperation, Anomalie } from '../../types/models';

function nowMs(): number {
  return Date.now();
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Cree une operation de TEST (Sprint 2.3, en attendant les vrais formulaires
 * du Sprint 3). Prend une etape et un produit existants en local.
 */
export async function createOperationTest(): Promise<string> {
  const db = await getDatabase();

  // Prendre la premiere etape disponible
  const etape = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM etape WHERE is_deleted = 0 LIMIT 1;',
  );
  if (!etape) {
    throw new Error('Aucune etape en local. Synchronise d\'abord (pull).');
  }

  // Prendre le premier produit disponible
  const produit = await db.getFirstAsync<{ code_x3: string; prix_unitaire: number }>(
    'SELECT code_x3, prix_unitaire FROM produit LIMIT 1;',
  );
  if (!produit) {
    throw new Error('Aucun produit en local. Synchronise d\'abord (pull).');
  }

  const opUuid = Crypto.randomUUID();
  const ligneUuid = Crypto.randomUUID();
  const ts = nowMs();
  const montant = produit.prix_unitaire * 2;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO operation
       (uuid, etape_uuid, type_operation, sous_type, date_heure,
        latitude, longitude, mode_paiement, montant_total, montant_encaisse,
        est_encaissee, signature_livreur, signature_client, nom_signataire_client,
        commentaire, sync_status, last_modified, is_deleted)
       VALUES (?, ?, 'COLLECTE', 'BCR', ?, 12.3650, -1.5236, 'ESPECES',
               ?, ?, 1, '', '', 'Client test', 'Operation de test (Sprint 2.3)',
               'PENDING', ?, 0);`,
      [opUuid, etape.uuid, nowIso(), montant, montant, ts],
    );
    await db.runAsync(
      `INSERT INTO ligne_operation
       (uuid, operation_uuid, produit_code_x3, quantite_realisee,
        quantite_collectee_vide, quantite_consignee, quantite_deconsignee,
        montant_ligne, sync_status, last_modified, is_deleted)
       VALUES (?, ?, ?, 2, 0, 0, 0, ?, 'PENDING', ?, 0);`,
      [ligneUuid, opUuid, produit.code_x3, montant, ts],
    );
  });

  return opUuid;
}

// ---- Lecture des PENDING (pour le push) ----

export async function getPendingOperations(): Promise<Operation[]> {
  const db = await getDatabase();
  return db.getAllAsync<Operation>(
    "SELECT * FROM operation WHERE sync_status = 'PENDING' AND is_deleted = 0;",
  );
}

export async function getPendingLignesOperation(): Promise<LigneOperation[]> {
  const db = await getDatabase();
  return db.getAllAsync<LigneOperation>(
    "SELECT * FROM ligne_operation WHERE sync_status = 'PENDING' AND is_deleted = 0;",
  );
}

export async function getPendingAnomalies(): Promise<Anomalie[]> {
  const db = await getDatabase();
  return db.getAllAsync<Anomalie>(
    "SELECT * FROM anomalie WHERE sync_status = 'PENDING' AND is_deleted = 0;",
  );
}

// ---- Marquage SYNCED apres push reussi ----

export async function markOperationsSynced(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const placeholders = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE operation SET sync_status = 'SYNCED' WHERE uuid IN (${placeholders});`,
    uuids,
  );
}

export async function markLignesSynced(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const placeholders = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE ligne_operation SET sync_status = 'SYNCED' WHERE uuid IN (${placeholders});`,
    uuids,
  );
}

export async function markAnomaliesSynced(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const placeholders = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE anomalie SET sync_status = 'SYNCED' WHERE uuid IN (${placeholders});`,
    uuids,
  );
}

export async function countPending(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM operation WHERE sync_status='PENDING' AND is_deleted=0) +
       (SELECT COUNT(*) FROM ligne_operation WHERE sync_status='PENDING' AND is_deleted=0) +
       (SELECT COUNT(*) FROM anomalie WHERE sync_status='PENDING' AND is_deleted=0) AS n;`,
  );
  return row?.n ?? 0;
}
