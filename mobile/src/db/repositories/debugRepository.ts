/**
 * Repository de debug : comptage des lignes de chaque table SQLite locale.
 *
 * Ce module expose getTableCounts(), qui retourne le nombre de lignes
 * de chaque table métier. Utilisé exclusivement par DebugScreen pour
 * afficher l'état de la base locale dans l'écran Debug BDD (accessible
 * uniquement via 7 taps + PIN serveur).
 *
 * En production, inspecter la BDD depuis l'app est
 * inutile pour le livreur. Cet écran est réservé au développement et
 * aux démonstrations : il permet de vérifier visuellement que les pulls
 * et pushes ont bien peuplé la base sans passer par un client SQLite.
 *
 * WHY (COUNT(*) sans filtre is_deleted) : On compte TOUTES les lignes,
 * y compris les soft-deleted, pour voir le volume total stocké en base.
 * Un comptage filtré masquerait des lignes que SQLite stocke encore.
 */
import { getDatabase } from '../database';

export interface TableCounts {
  [table: string]: number;
}

const TABLES = [
  'client', 'plv', 'article',
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
