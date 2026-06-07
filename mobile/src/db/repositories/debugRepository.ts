/**
 * Repository de debug : compte les lignes de chaque table.
 * Utile pour verifier visuellement l'etat de la base locale.
 */
import { getDatabase } from '../database';

export interface TableCounts {
  [table: string]: number;
}

const TABLES = [
  'client', 'plv', 'produit',
  'programme', 'etape', 'ligne_programme',
  'operation', 'ligne_operation', 'anomalie', 'photo',
];

export async function getTableCounts(): Promise<TableCounts> {
  const db = await getDatabase();
  const counts: TableCounts = {};
  for (const table of TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table};`,
    );
    counts[table] = row?.n ?? 0;
  }
  return counts;
}
