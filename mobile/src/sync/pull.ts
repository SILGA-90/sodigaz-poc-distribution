/**
 * Synchronisation descendante (serveur -> mobile).
 * Récupère le delta serveur depuis lastPulledAt et l'applique en transaction.
 */
import { isAxiosError } from 'axios';
import { SQLiteDatabase } from 'expo-sqlite';
import apiClient from '../api/client';
import { getDatabase, getLastPulledAt, setLastPulledAt } from '../db/database';
import { TableChanges, PullResponse, PullResult } from './types';

/**
 * Convertit un booléen JSON (true/false) en entier SQLite (1/0).
 * SQLite n'a pas de type BOOLEAN natif. Les colonnes booléennes sont
 * stockées en INTEGER (0/1) dans notre schéma.
 */
export function bool(value: any): number {
  return value ? 1 : 0;
}

/**
 * Applique un lot de changements { created, updated, deleted } sur une
 * table SQLite locale. Délègue l'INSERT à un callback `insertRow`.
 *
 * Le serveur retourne toujours `created: []`
 * et met tout dans `updated`. On parcourt les deux listes pour être
 * robuste si ce comportement change un jour.
 *
 * Pour les référentiels (client, plv, article), on
 * veut écraser l'enregistrement existant si le serveur envoie une version
 * plus récente. Sûr car ces tables n'ont pas de données locales PENDING.
 *
 * Les référentiels n'ont pas de suppression logique
 * (is_deleted absent). On ne passe donc pas de deleteTable pour ces tables.
 */
async function applyRows(
  db: SQLiteDatabase,
  changes: TableChanges | undefined,
  insertRow: (r: any) => Promise<unknown>,
  deleteTable?: string,
): Promise<number> {
  if (!changes) return 0;
  const rows = [...changes.created, ...changes.updated];
  for (const r of rows) {
    await insertRow(r);
  }
  if (deleteTable) {
    // Suppression physique des enregistrements marqués is_deleted côté serveur.
    // WHY : côté mobile on supprime vraiment (pas de soft delete local) pour
    //       ne pas afficher des données obsolètes à l'utilisateur.
    for (const uuid of changes.deleted ?? []) {
      await db.runAsync(`DELETE FROM ${deleteTable} WHERE uuid = ?;`, [uuid]);
    }
  }
  return rows.length;
}

async function applyClients(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(db, changes, (r) =>
    db.runAsync(
      `INSERT OR REPLACE INTO client
       (id, code_x3, raison_sociale, type_client, contact, telephone, actif)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.code_x3, r.raison_sociale, r.type_client ?? '', r.contact ?? '', r.telephone ?? '', bool(r.actif)],
    ),
  );
}

async function applyPlvs(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(db, changes, (r) =>
    db.runAsync(
      `INSERT OR REPLACE INTO plv
       (id, client_id, libelle, adresse, latitude, longitude, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.client_id, r.libelle, r.adresse ?? '', r.latitude, r.longitude, r.statut ?? 'ACTIF'],
    ),
  );
}

async function applyArticles(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(db, changes, (r) =>
    db.runAsync(
      `INSERT OR REPLACE INTO article
       (id, code_x3, libelle, type_emballage, prix_unitaire, montant_consignation, actif)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.code_x3, r.libelle, r.type_emballage ?? '', r.prix_unitaire ?? 0, r.montant_consignation ?? 0, bool(r.actif)],
    ),
  );
}

async function applyProgrammes(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(
    db, changes,
    (r) => db.runAsync(
      `INSERT OR REPLACE INTO programme
       (id, uuid, numero_x3, utilisateur_id, vehicule_id, date_programme,
        type_programme, statut, heure_debut, heure_fin, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.uuid, r.numero_x3 ?? '', r.utilisateur_id, r.vehicule_id ?? null,
       r.date_programme, r.type_programme, r.statut,
       r.heure_debut ?? null, r.heure_fin ?? null, r.last_modified ?? 0, bool(r.is_deleted)],
    ),
    'programme',
  );
}

async function applyEtapes(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(
    db, changes,
    (r) => db.runAsync(
      `INSERT OR REPLACE INTO etape
       (id, uuid, programme_id, plv_id, ordre_prevu, ordre_optimise,
        statut_visite, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.uuid, r.programme_id, r.plv_id, r.ordre_prevu,
       r.ordre_optimise ?? null, r.statut_visite, r.last_modified ?? 0, bool(r.is_deleted)],
    ),
    'etape',
  );
}

async function applyLignesProgramme(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(
    db, changes,
    (r) => db.runAsync(
      `INSERT OR REPLACE INTO ligne_programme
       (id, uuid, etape_id, produit_id, quantite_prevue, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.uuid, r.etape_id, r.produit_id, r.quantite_prevue, r.last_modified ?? 0, bool(r.is_deleted)],
    ),
    'ligne_programme',
  );
}

/**
 * Applique les opérations reçues du serveur (re-pull des opérations
 * déjà poussées, potentiellement corrigées par le superviseur).
 *
 * On n'écrase JAMAIS une opération PENDING locale.
 * Une opération PENDING n'a pas encore été envoyée au serveur, donc
 * elle n'apparaît pas dans le pull (le serveur ne la connaît pas encore).
 * Si par construction elle apparaissait, OR IGNORE la protège.
 * La prochaine sync complète (PENDING -> SYNCED -> pull) réconciliera.
 */
async function applyOperations(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(
    db, changes,
    (r) => db.runAsync(
      `INSERT OR IGNORE INTO operation
       (uuid, etape_uuid, type_operation, sous_type, date_heure,
        latitude, longitude, gps_precision, gps_horodatage,
        mode_paiement, montant_total, montant_encaisse,
        est_encaissee, signature_livreur, signature_client, nom_signataire_client,
        commentaire, sync_status, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, 0);`,
      [
        String(r.uuid), r.etape_uuid, r.type_operation, r.sous_type ?? null,
        r.date_heure, r.latitude ?? null, r.longitude ?? null,
        r.gps_precision ?? null, r.gps_horodatage ?? null,
        r.mode_paiement ?? null, r.montant_total ?? 0, r.montant_encaisse ?? 0,
        r.est_encaissee ? 1 : 0,
        r.signature_livreur ?? '', r.signature_client ?? '',
        r.nom_signataire_client ?? '', r.commentaire ?? '',
        r.last_modified ?? 0,
      ],
    ),
    'operation',
  );
}

/**
 * Applique les lignes d'opération reçues du serveur.
 * Même raison que pour les opérations : ne jamais
 * écraser une ligne PENDING locale non encore synchronisée.
 */
async function applyLignesOperation(db: SQLiteDatabase, changes?: TableChanges): Promise<number> {
  return applyRows(
    db, changes,
    (r) => db.runAsync(
      `INSERT OR IGNORE INTO ligne_operation
       (uuid, operation_uuid, produit_code_x3, quantite_realisee,
        quantite_collectee_vide, quantite_consignee, quantite_deconsignee,
        montant_ligne, sync_status, last_modified, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, 0);`,
      [
        String(r.uuid), r.operation_uuid, r.produit_code_x3,
        r.quantite_realisee ?? 0, r.quantite_collectee_vide ?? 0,
        r.quantite_consignee ?? 0, r.quantite_deconsignee ?? 0,
        r.montant_ligne ?? 0, r.last_modified ?? 0,
      ],
    ),
    'ligne_operation',
  );
}

/**
 * Interroge le serveur pour obtenir tous les enregistrements modifiés
 * depuis `lastPulledAt` et les applique dans la base SQLite locale.
 * Sauvegarde le nouveau timestamp serveur pour le prochain pull.
 *
 * Toutes les tables sont écrites dans une seule
 * transaction atomique. Si une table échoue, aucune donnée partielle
 * n'est persistée et le prochain pull recommencera depuis le même
 * lastPulledAt (pas de trou ni de doublon).
 */
export async function pull(): Promise<PullResult> {
  const lastPulledAt = await getLastPulledAt();

  let response;
  try {
    response = await apiClient.post<PullResponse>('/api/sync/pull/', { lastPulledAt });
  } catch (e: unknown) {
    return {
      success: false,
      timestamp: lastPulledAt,
      counts: {},
      error: isAxiosError(e) ? (e.response?.data?.detail ?? e.message ?? 'Erreur reseau') : (e instanceof Error ? e.message : 'Erreur reseau'),
    };
  }

  const { changes, timestamp } = response.data;
  const db     = await getDatabase();
  const counts: Record<string, number> = {};

  try {
    await db.withTransactionAsync(async () => {
      counts.client          = await applyClients(db, changes.client);
      counts.plv             = await applyPlvs(db, changes.plv);
      counts.article         = await applyArticles(db, changes.article);
      counts.programme       = await applyProgrammes(db, changes.programme);
      counts.etape           = await applyEtapes(db, changes.etape);
      counts.ligne_programme = await applyLignesProgramme(db, changes.ligne_programme);
      counts.operation       = await applyOperations(db, changes.operation);
      counts.ligne_operation = await applyLignesOperation(db, changes.ligne_operation);
    });
  } catch (e: unknown) {
    return {
      success: false,
      timestamp: lastPulledAt,
      counts: {},
      error: 'Erreur lors de l\'application des donnees : ' + (e instanceof Error ? e.message : String(e)),
    };
  }

  // On sauvegarde le timestamp seulement si la transaction a réussi.
  // WHY : si on le sauvegardait avant, un échec de transaction laisserait le
  //       mobile avec un lastPulledAt avancé sans que les données aient été écrites.
  await setLastPulledAt(timestamp);
  return { success: true, timestamp, counts };
}
