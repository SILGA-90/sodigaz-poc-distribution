/**
 * Repository des operations : creation locale, lecture des PENDING, marquage SYNCED.
 *
 * Les operations sont creees sur le mobile (hors ligne possible) avec
 * sync_status = 'PENDING'. Le service de push les remonte au serveur et
 * les passe a 'SYNCED'.
 */
import { getDatabase } from '../database';
import { Operation, LigneOperation, Anomalie } from '../../types/models';

export async function getPendingOperations(): Promise<Operation[]> {
  const db = await getDatabase();
  // JOIN etape : exclut les operations orphelines dont l'etape n'existe pas en
  // local (ex. si l'etape a ete supprimee ou appartient a un autre compte).
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

// 'photo' est géré par photoRepository.markPhotoMetaSynced (cycle d'upload distinct).
type SyncTable = 'operation' | 'ligne_operation' | 'anomalie';

/**
 * Passe sync_status = 'SYNCED' pour une liste d'UUIDs dans la table indiquee.
 * Remplace les anciennes fonctions markOperationsSynced / markLignesSynced / markAnomaliesSynced.
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
       (SELECT COUNT(*) FROM anomalie        WHERE sync_status = 'PENDING' AND is_deleted = 0) AS n;`,
  );
  return row?.n ?? 0;
}
