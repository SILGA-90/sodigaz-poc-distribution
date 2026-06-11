/**
 * Repository des opérations : lecture des PENDING, marquage SYNCED.
 *
 * Ce module expose les fonctions de lecture/mise à jour utilisées par
 * le service de synchronisation push (syncService.ts). Les opérations
 * sont créées par saisieRepository.ts et uploadées ici.
 *
 * Le JOIN sur etape (is_deleted = 0)
 * exclut les opérations orphelines dont l'étape a été supprimée localement.
 * Sans ce filtre, le push tenterait d'envoyer une opération pour une
 * étape qui n'existe plus côté serveur, provoquant une erreur 400.
 *
 * Opérations, lignes et anomalies ont
 * toutes le même cycle PENDING -> SYNCED. Plutôt que de trois fonctions
 * identiques (markOperationsSynced, markLignesSynced, markAnomaliesSynced),
 * une seule fonction paramétrée réduit la duplication et les bugs de
 * copier-coller. La table est dans la liste fermée SyncTable : pas de
 * risque d'injection SQL (pas de saisie utilisateur).
 *
 * Le compteur de synchronisation affiché
 * dans NetworkBanner doit refléter toutes les données en attente, y compris
 * les binaires photo (upload_status = 'PENDING'). Une photo dont les
 * métadonnées sont SYNCED mais le fichier non uploadé compte encore comme
 * en attente pour l'utilisateur.
 */
import { getDatabase } from '../database';
import { Operation, LigneOperation, Anomalie } from '../../types/models';

export async function getPendingOperations(): Promise<Operation[]> {
  const db = await getDatabase();
  // JOIN etape : exclut les opérations orphelines dont l'étape n'existe pas en
  // local (ex. si l'étape a été supprimée ou appartient à un autre compte).
  return db.getAllAsync<Operation>(
    `SELECT o.* FROM operation o
     JOIN etape e ON e.uuid = o.etape_uuid AND e.is_deleted = 0
     WHERE o.sync_status = 'PENDING' AND o.is_deleted = 0;`,
  );
}

export async function getPendingLignesOperation(): Promise<LigneOperation[]> {
  const db = await getDatabase();
  return db.getAllAsync<LigneOperation>(
    `SELECT lo.* FROM ligne_operation lo
     JOIN operation o ON o.uuid = lo.operation_uuid AND o.is_deleted = 0
     JOIN etape e ON e.uuid = o.etape_uuid AND e.is_deleted = 0
     WHERE lo.sync_status = 'PENDING' AND lo.is_deleted = 0;`,
  );
}

export async function getPendingAnomalies(): Promise<Anomalie[]> {
  const db = await getDatabase();
  return db.getAllAsync<Anomalie>(
    "SELECT * FROM anomalie WHERE sync_status = 'PENDING' AND is_deleted = 0;",
  );
}

// Liste fermée : pas de saisie utilisateur -> pas de risque d'injection SQL.
type SyncTable = 'operation' | 'ligne_operation' | 'anomalie';

/**
 * Passe sync_status = 'SYNCED' pour une liste d'UUIDs dans la table indiquée.
 * opérations, lignes et anomalies partagent le même
 * cycle PENDING -> SYNCED. Une seule fonction évite la duplication.
 */
export async function markTableSynced(tableName: SyncTable, uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDatabase();
  const placeholders = uuids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE ${tableName} SET sync_status = 'SYNCED' WHERE uuid IN (${placeholders});`,
    uuids,
  );
}

export async function countPending(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM operation       WHERE sync_status = 'PENDING' AND is_deleted = 0) +
       (SELECT COUNT(*) FROM ligne_operation WHERE sync_status = 'PENDING' AND is_deleted = 0) +
       (SELECT COUNT(*) FROM anomalie        WHERE sync_status = 'PENDING' AND is_deleted = 0) +
       (SELECT COUNT(*) FROM photo           WHERE (sync_status = 'PENDING' OR upload_status = 'PENDING')
                                               AND is_deleted = 0) AS n;`,
  );
  return row?.n ?? 0;
}
