/**
 * Service de synchronisation offline-first : cœur technique du mémoire.
 *
 * Ce module orchestre les échanges bidirectionnels entre la base SQLite
 * locale (expo-sqlite) et l'API Django. Il expose trois fonctions
 * publiques : pull(), push() et syncAll().
 *
 * Le livreur travaille en zone à couverture réseau
 * variable. Toutes les saisies sont d'abord écrites en local avec le
 * statut PENDING, puis poussées vers le serveur dès que le réseau
 * est disponible. L'ordre pull -> push garantit que le mobile dispose
 * toujours des données serveur les plus récentes avant d'envoyer les
 * siennes.
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
import { isAxiosError } from 'axios';
import { SQLiteDatabase } from 'expo-sqlite';
import apiClient from '../api/client';
import {
  getDatabase,
  getLastPulledAt,
  setLastPulledAt,
  getCloturesPending,
  clearCloturesPending,
} from '../db/database';
import {
  getPendingOperations,
  getPendingLignesOperation,
  getPendingAnomalies,
  markTableSynced,
} from '../db/repositories/operationRepository';
import { purgerDonneesAnciennes } from '../db/repositories/programmeRepository';
import {
  getPhotosPendingMeta,
  getPhotosPendingUpload,
  markPhotoMetaSynced,
  markPhotoUploaded,
  markPhotoFileLost,
} from '../db/repositories/photoRepository';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../config/api';
import { getItem, STORAGE_KEYS } from '../storage/secureStorage';
import logger from '../services/logger';

interface TableChanges {
  created: any[];
  updated: any[];
  deleted: string[];
}

interface PullResponse {
  changes: Record<string, TableChanges>;
  timestamp: number;
}

export interface PullResult {
  success: boolean;
  timestamp: number;
  counts: Record<string, number>;
  error?: string;
}

/**
 * Convertit un booléen JSON (true/false) en entier SQLite (1/0).
 * SQLite n'a pas de type BOOLEAN natif. Les colonnes booléennes sont
 * stockées en INTEGER (0/1) dans notre schéma.
 */
function bool(value: any): number {
  return value ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Helper générique : application des changements descendants (pull)
// ---------------------------------------------------------------------------

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
 *
 * @param db          Instance SQLite ouverte
 * @param changes     Payload { created, updated, deleted } reçu du serveur
 * @param insertRow   Callback exécutant l'INSERT OR REPLACE pour une ligne
 * @param deleteTable Nom de la table pour la suppression par uuid (optionnel)
 * @returns           Nombre de lignes traitées (created + updated)
 */
async function applyRows(
  db: SQLiteDatabase,
  changes: TableChanges | undefined,
  insertRow: (r: any) => Promise<void>,
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

// ---------------------------------------------------------------------------
// Application table par table : données descendantes (pull)
// ---------------------------------------------------------------------------

/** WHAT : Met à jour le référentiel des clients depuis le serveur. */
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

/** WHAT : Met à jour le référentiel des PLV (Points de Livraison) depuis le serveur. */
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

/** WHAT : Met à jour le référentiel des articles (bouteilles gaz) depuis le serveur. */
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

/** WHAT : Applique les programmes du livreur reçus du serveur. */
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

/** WHAT : Applique les étapes (visites PLV prévues) reçues du serveur. */
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

/** WHAT : Applique les lignes de programme (quantités prévues par article). */
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

// ===========================================================================
// PULL : récupération des changements serveur
// ===========================================================================

/**
 * Interroge le serveur pour obtenir tous les enregistrements modifiés
 * depuis `lastPulledAt` et les applique dans la base SQLite locale.
 * Sauvegarde le nouveau timestamp serveur pour le prochain pull.
 *
 * Toutes les tables sont écrites dans une seule
 * transaction atomique. Si une table échoue, aucune donnée partielle
 * n'est persistée et le prochain pull recommencera depuis le même
 * lastPulledAt (pas de trou ni de doublon).
 *
 * Signale au serveur que c'est un
 * premier pull : il renverra l'intégralité des données accessibles.
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
    // Transaction atomique : on applique toutes les tables ou aucune.
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

// ===========================================================================
// PUSH : envoi des données terrain vers le serveur
// ===========================================================================

export interface PushResult {
  success: boolean;
  pushed: { operation: number; ligne_operation: number; anomalie: number };
  error?: string;
}

/**
 * Récupère les UUIDs des étapes marquées ECHEC localement.
 * Ces étapes sont transmises séparément dans le payload push (champ
 * `echec_etapes`) plutôt que dans les `changes` habituels, car un
 * échec de visite n'est pas une "création de donnée" à proprement parler.
 */
async function getEchecEtapeUuids(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ uuid: string }>(
    `SELECT uuid FROM etape WHERE statut_visite = 'ECHEC' AND is_deleted = 0;`,
  );
  return rows.map((r) => r.uuid);
}

/**
 * Envoie toutes les données PENDING (opérations, lignes, anomalies,
 * photos) au serveur, puis marque les enregistrements synchronisés.
 *
 * Permet au serveur de détecter un push
 * basé sur des données potentiellement périmées (si le pull a échoué).
 * Non exploité dans ce POC mais prévu pour une gestion de conflit future.
 *
 * On ne marque SYNCED qu'après
 * confirmation du serveur. Si le réseau coupe, les données restent
 * PENDING et seront renvoyées au prochain cycle (idempotence garantie
 * par update_or_create côté serveur).
 *
 * Les métadonnées JSON sont poussées ici.
 * Les fichiers binaires sont envoyés ensuite via uploaderPhotosBinaires()
 * pour permettre des re-tentatives indépendantes.
 */
export async function push(): Promise<PushResult> {
  const operations      = await getPendingOperations();
  const lignes          = await getPendingLignesOperation();
  const anomalies       = await getPendingAnomalies();
  const photosMeta      = await getPhotosPendingMeta();
  const echecEtapeUuids = await getEchecEtapeUuids();

  const empty = { operation: 0, ligne_operation: 0, anomalie: 0 };

  // Optimisation : si rien à envoyer, on tente quand même les uploads binaires
  // en attente (photos dont la métadonnée est SYNCED mais le fichier pas encore).
  if (
    operations.length === 0 && lignes.length === 0 &&
    anomalies.length === 0 && photosMeta.length === 0 &&
    echecEtapeUuids.length === 0
  ) {
    await uploaderPhotosBinaires();
    return { success: true, pushed: empty };
  }

  const lastPulledAt = await getLastPulledAt();

  // Construction du payload. Toutes les données PENDING passent dans `created`.
  // WHY : Le mobile ne distingue pas created/updated dans le push : le serveur
  //       utilise update_or_create par UUID dans les deux cas.
  const payload = {
    lastPulledAt,
    echec_etapes: echecEtapeUuids,
    changes: {
      operation: {
        created: operations.map((o) => ({
          uuid:                  o.uuid,
          etape_uuid:            o.etape_uuid,
          type_operation:        o.type_operation,
          sous_type:             o.sous_type ?? null,
          date_heure:            o.date_heure,
          latitude:              o.latitude,
          longitude:             o.longitude,
          gps_precision:         o.gps_precision ?? null,
          gps_horodatage:        o.gps_horodatage ?? null,
          mode_paiement:         o.mode_paiement ?? null,
          montant_total:         o.montant_total,
          montant_encaisse:      o.montant_encaisse,
          est_encaissee:         o.est_encaissee === 1,
          signature_livreur:     o.signature_livreur ?? '',
          signature_client:      o.signature_client ?? '',
          nom_signataire_client: o.nom_signataire_client ?? '',
          commentaire:           o.commentaire ?? '',
        })),
        updated: [],
        deleted: [],
      },
      ligne_operation: {
        created: lignes.map((l) => ({
          uuid:                    l.uuid,
          operation_uuid:          l.operation_uuid,
          produit_code_x3:         l.produit_code_x3,
          quantite_realisee:       l.quantite_realisee,
          quantite_collectee_vide: l.quantite_collectee_vide,
          quantite_consignee:      l.quantite_consignee,
          quantite_deconsignee:    l.quantite_deconsignee,
          montant_ligne:           l.montant_ligne,
        })),
        updated: [],
        deleted: [],
      },
      anomalie: {
        created: anomalies.map((a) => ({
          uuid:           a.uuid,
          programme_uuid: a.programme_uuid,
          plv_id:         a.plv_id,
          type_anomalie:  a.type_anomalie,
          gravite:        a.gravite,
          description:    a.description,
          statut:         a.statut,
          date_heure:     a.date_heure,
          latitude:       a.latitude,
          longitude:      a.longitude,
        })),
        updated: [],
        deleted: [],
      },
      photo: {
        created: photosMeta.map((p) => ({
          uuid:           p.uuid,
          operation_uuid: p.operation_uuid,
          anomalie_uuid:  p.anomalie_uuid,
          type_photo:     p.type_photo,
          date_heure:     p.date_heure,
          latitude:       p.latitude,
          longitude:      p.longitude,
          taille_octets:  p.taille_octets,
        })),
        updated: [],
        deleted: [],
      },
    },
  };

  try {
    await apiClient.post('/api/sync/push/', payload);
  } catch (e: unknown) {
    return {
      success: false,
      pushed: empty,
      error: isAxiosError(e) ? (e.response?.data?.detail ?? e.message ?? 'Erreur reseau') : (e instanceof Error ? e.message : 'Erreur reseau'),
    };
  }

  // Marquage SYNCED uniquement après confirmation du serveur (200 OK).
  await markTableSynced('operation',       operations.map((o) => o.uuid));
  await markTableSynced('ligne_operation', lignes.map((l) => l.uuid));
  await markTableSynced('anomalie',        anomalies.map((a) => a.uuid));
  await markPhotoMetaSynced(photosMeta.map((p) => p.uuid));

  // Upload des binaires photos dont la métadonnée vient d'être synchronisée.
  await uploaderPhotosBinaires();

  return {
    success: true,
    pushed: {
      operation:       operations.length,
      ligne_operation: lignes.length,
      anomalie:        anomalies.length,
    },
  };
}

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
export async function syncAll(): Promise<{ pull: PullResult; push: PushResult }> {
  await pushClotures();
  const pullResult = await pull();
  const pushResult = await push();
  if (pullResult.success && pushResult.success) {
    purgerDonneesAnciennes(90).catch(() => {});
  }
  return { pull: pullResult, push: pushResult };
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
async function pushClotures(): Promise<void> {
  const uuids = await getCloturesPending();
  if (uuids.length === 0) return;
  try {
    await apiClient.post('/api/sync/programmes/cloturer/', { uuids });
    await clearCloturesPending(uuids);
  } catch (e) {
    logger.warn('Push cloture echoue :', e);
  }
}

/**
 * Envoie les fichiers binaires (images) des photos dont la métadonnée
 * a déjà été synchronisée (sync_status = SYNCED) mais dont le fichier
 * n'a pas encore été uploadé (upload_status = PENDING).
 *
 * L'upload d'un fichier est plus lourd et plus
 * fragile que l'envoi de JSON. Le séparer permet de re-tenter uniquement
 * l'upload sans repousser toutes les métadonnées. Les deux étapes sont
 * indépendantes et rejouables.
 *
 * Le cache Android peut être vidé entre la prise de photo
 * et l'upload. Si le fichier local n'existe plus, on marque la photo
 * FILE_LOST (distinct de DONE) pour ne pas boucler indéfiniment.
 */
async function uploaderPhotosBinaires(): Promise<void> {
  const photos = await getPhotosPendingUpload();
  if (photos.length === 0) return;

  const token = await getItem(STORAGE_KEYS.ACCESS_TOKEN);

  for (const photo of photos) {
    try {
      const info = await FileSystem.getInfoAsync(photo.local_uri);
      if (!info.exists) {
        await markPhotoFileLost(photo.uuid);
        logger.warn('[sync] photo FILE_LOST :', photo.uuid, photo.local_uri);
        continue;
      }

      const uploadUrl = `${API_BASE_URL}/api/sync/photos/${photo.uuid}/upload/`;
      const result    = await FileSystem.uploadAsync(uploadUrl, photo.local_uri, {
        httpMethod:  'POST',
        uploadType:  FileSystem.FileSystemUploadType.MULTIPART,
        fieldName:   'fichier',
        headers:     { Authorization: `Bearer ${token}` },
      });
      if (result.status === 200) {
        await markPhotoUploaded(photo.uuid);
      }
    } catch (e) {
      logger.warn('Upload photo echoue :', photo.uuid, e);
    }
  }
}
