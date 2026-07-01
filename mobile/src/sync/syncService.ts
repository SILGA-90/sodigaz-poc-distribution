/**
 * Service de synchronisation offline-first : cœur technique du mémoire.
 *
 * Ce module orchestre les échanges bidirectionnels entre la base SQLite
 * locale (expo-sqlite) et l'API Django.
 *
 * Protocole (inspiré de WatermelonDB, mais codé à la main) :
 *   syncAll() = pushClotures() -> pull() -> push()
 *
 *   - pushClotures : envoie les programmes clôturés AVANT le pull pour éviter
 *                    que le pull n'écrase le statut CLOTURE local avec PLANIFIE.
 *   - pull         : POST /api/sync/pull/  : récupère les changements serveur
 *                    depuis lastPulledAt, les applique en transaction SQLite.
 *   - push         : POST /api/sync/push/  : remonte les données PENDING.
 *
 * Invariants critiques (ne pas modifier sans comprendre les implications) :
 *   1. pull AVANT push (voir ci-dessus).
 *   2. last_modified jamais écrit à la main côté mobile (trigger PostgreSQL).
 *   3. Le push est idempotent : update_or_create par UUID côté serveur.
 *   4. Les opérations INSERT OR IGNORE sur operation/ligne_operation préservent
 *      les données PENDING locales que le pull ne doit pas écraser.
 */
import apiClient from '../api/client';
import { getCloturesPending, clearCloturesPending } from '../db/database';
import { purgerDonneesAnciennes } from '../db/repositories/programmeRepository';
import logger from '../services/logger';
import { pull } from './pull';
import { push } from './push';
import type { PullResult, PushResult } from './types';

export { pull, push };
export type { PullResult, PushResult };

// ===========================================================================
// ORCHESTRATION : cycle de synchronisation complet
// ===========================================================================

/**
 * Exécute un cycle de synchronisation complet dans l'ordre correct :
 * pushClotures -> pull -> push.
 *
 * Si le livreur clôture son programme puis
 * déclenche une sync, le pull qui suivrait retournerait un statut
 * PLANIFIE/EN_COURS (côté serveur la clôture n'est pas encore connue)
 * et écraserait le statut CLOTURE local. En poussant les clôtures avant
 * le pull, le serveur est à jour et le pull renverra CLOTURE.
 *
 * On supprime les données locales de plus de 90 jours
 * après une sync réussie pour limiter la taille de la base SQLite.
 * On ne purge QUE si pull ET push ont réussi pour ne pas supprimer des
 * données PENDING qui n'auraient pas encore été envoyées.
 */
export async function syncAll(): Promise<{ pull: PullResult; push: PushResult; clotureEchouee: boolean }> {
  const clotureEchouee = !(await pushClotures());
  const pullResult = await pull();
  const pushResult = await push();
  if (pullResult.success && pushResult.success) {
    purgerDonneesAnciennes(90).catch(() => {});
  }
  return { pull: pullResult, push: pushResult, clotureEchouee };
}

/**
 * Envoie les UUIDs des programmes clôturés localement mais pas encore
 * confirmés côté serveur.
 *
 * On ne peut pas stocker la clôture pending
 * dans la colonne `statut` de la table `programme`, car le pull suivant
 * ferait un INSERT OR REPLACE qui remettrait le statut à EN_COURS.
 * La table `sync_meta` (clé/valeur) survive aux INSERT OR REPLACE.
 *
 * En cas d'échec réseau, la clôture reste dans la file
 * et sera retentée au prochain syncAll(). Pas de blocage du push principal.
 */
async function pushClotures(): Promise<boolean> {
  const uuids = await getCloturesPending();
  if (uuids.length === 0) return true;
  try {
    await apiClient.post('/api/sync/programmes/cloturer/', { uuids });
    await clearCloturesPending(uuids);
    return true;
  } catch (e) {
    logger.warn('Push cloture echoue :', e);
    return false;
  }
}
