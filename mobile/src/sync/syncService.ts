/**
 * Service de synchronisation offline-first.
 *
 * Protocole : syncAll() = pushClotures() → pull() → push()
 *   - pull  : POST /api/sync/pull/  — recoit les changements serveur, les ecrit en local
 *   - push  : POST /api/sync/push/  — remonte les donnees terrain (PENDING) au serveur
 *
 * Invariants a respecter :
 *   - pull AVANT push (evite d'ecraser une cloture locale avec un statut serveur perime)
 *   - idempotence : le push est rejoue sans risque grace a update_or_create par UUID cote serveur
 *   - last_modified jamais ecrit a la main (trigger PostgreSQL cote serveur)
 */
import apiClient from '../api/client';
import { getDatabase, getLastPulledAt, setLastPulledAt, getCloturesPending, clearCloturesPending } from '../db/database';
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

/** Convertit un booleen JSON (true/false) en entier SQLite (1/0). */
function bool(value: any): number {
  return value ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Helper generique pour l'application des changements descendant (pull)
// ---------------------------------------------------------------------------

/**
 * Applique un lot de changements (created + updated) sur une table SQLite.
 *
 * @param db          Instance de la base SQLite
 * @param changes     Objet {created, updated, deleted} recu du serveur
 * @param insertRow   Callback qui execute l'INSERT OR REPLACE pour une ligne
 * @param deleteTable Nom de la table pour la suppression par uuid (optionnel ;
 *                    les tables referentielles n'ont pas de suppression logique)
 * @returns           Nombre de lignes creees ou mises a jour
 */
async function applyRows(
  db: any,
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
    for (const uuid of changes.deleted ?? []) {
      await db.runAsync(`DELETE FROM ${deleteTable} WHERE uuid = ?;`, [uuid]);
    }
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Application table par table — pull
// ---------------------------------------------------------------------------

async function applyClients(db: any, changes?: TableChanges): Promise<number> {
  return applyRows(db, changes, (r) =>
    db.runAsync(
      `INSERT OR REPLACE INTO client
       (id, code_x3, raison_sociale, type_client, contact, telephone, actif)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.code_x3, r.raison_sociale, r.type_client ?? '', r.contact ?? '', r.telephone ?? '', bool(r.actif)],
    ),
  );
}

async function applyPlvs(db: any, changes?: TableChanges): Promise<number> {
  return applyRows(db, changes, (r) =>
    db.runAsync(
      `INSERT OR REPLACE INTO plv
       (id, client_id, libelle, adresse, latitude, longitude, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.client_id, r.libelle, r.adresse ?? '', r.latitude, r.longitude, r.statut ?? 'ACTIF'],
    ),
  );
}

async function applyProduits(db: any, changes?: TableChanges): Promise<number> {
  return applyRows(db, changes, (r) =>
    db.runAsync(
      `INSERT OR REPLACE INTO produit
       (id, code_x3, libelle, type_emballage, prix_unitaire, montant_consignation, actif)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [r.id, r.code_x3, r.libelle, r.type_emballage ?? '', r.prix_unitaire ?? 0, r.montant_consignation ?? 0, bool(r.actif)],
    ),
  );
}

async function applyProgrammes(db: any, changes?: TableChanges): Promise<number> {
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

async function applyEtapes(db: any, changes?: TableChanges): Promise<number> {
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

async function applyLignesProgramme(db: any, changes?: TableChanges): Promise<number> {
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

// ===========================================================================
// PULL
// ===========================================================================

export async function pull(): Promise<PullResult> {
  const lastPulledAt = await getLastPulledAt();

  let response;
  try {
    response = await apiClient.post<PullResponse>('/api/sync/pull/', { lastPulledAt });
  } catch (e: any) {
    return {
      success: false,
      timestamp: lastPulledAt,
      counts: {},
      error: e?.response?.data?.detail ?? e?.message ?? 'Erreur reseau',
    };
  }

  const { changes, timestamp } = response.data;
  const db = await getDatabase();
  const counts: Record<string, number> = {};

  try {
    await db.withTransactionAsync(async () => {
      counts.client          = await applyClients(db, changes.client);
      counts.plv             = await applyPlvs(db, changes.plv);
      counts.produit         = await applyProduits(db, changes.produit);
      counts.programme       = await applyProgrammes(db, changes.programme);
      counts.etape           = await applyEtapes(db, changes.etape);
      counts.ligne_programme = await applyLignesProgramme(db, changes.ligne_programme);
    });
  } catch (e: any) {
    return {
      success: false,
      timestamp: lastPulledAt,
      counts: {},
      error: 'Erreur lors de l\'application des donnees : ' + (e?.message ?? String(e)),
    };
  }

  await setLastPulledAt(timestamp);
  return { success: true, timestamp, counts };
}

// ===========================================================================
// PUSH
// ===========================================================================

export interface PushResult {
  success: boolean;
  pushed: { operation: number; ligne_operation: number; anomalie: number };
  error?: string;
}

async function getEchecEtapeUuids(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ uuid: string }>(
    `SELECT uuid FROM etape WHERE statut_visite = 'ECHEC' AND is_deleted = 0;`,
  );
  return rows.map((r) => r.uuid);
}

export async function push(): Promise<PushResult> {
  const operations  = await getPendingOperations();
  const lignes      = await getPendingLignesOperation();
  const anomalies   = await getPendingAnomalies();
  const photosMeta  = await getPhotosPendingMeta();
  const echecEtapeUuids = await getEchecEtapeUuids();

  const empty = { operation: 0, ligne_operation: 0, anomalie: 0 };

  if (
    operations.length === 0 && lignes.length === 0 &&
    anomalies.length === 0 && photosMeta.length === 0 &&
    echecEtapeUuids.length === 0
  ) {
    await uploaderPhotosBinaires();
    return { success: true, pushed: empty };
  }

  const lastPulledAt = await getLastPulledAt();

  const payload = {
    lastPulledAt,
    echec_etapes: echecEtapeUuids,
    changes: {
      operation: {
        created: operations.map((o) => ({
          uuid: o.uuid,
          etape_uuid: o.etape_uuid,
          type_operation: o.type_operation,
          sous_type: o.sous_type ?? null,
          date_heure: o.date_heure,
          latitude: o.latitude,
          longitude: o.longitude,
          gps_precision: o.gps_precision ?? null,
          gps_horodatage: o.gps_horodatage ?? null,
          mode_paiement: o.mode_paiement ?? null,
          montant_total: o.montant_total,
          montant_encaisse: o.montant_encaisse,
          est_encaissee: o.est_encaissee === 1,
          signature_livreur: o.signature_livreur ?? '',
          signature_client: o.signature_client ?? '',
          nom_signataire_client: o.nom_signataire_client ?? '',
          commentaire: o.commentaire ?? '',
        })),
        updated: [],
        deleted: [],
      },
      ligne_operation: {
        created: lignes.map((l) => ({
          uuid: l.uuid,
          operation_uuid: l.operation_uuid,
          produit_code_x3: l.produit_code_x3,
          quantite_realisee: l.quantite_realisee,
          quantite_collectee_vide: l.quantite_collectee_vide,
          quantite_consignee: l.quantite_consignee,
          quantite_deconsignee: l.quantite_deconsignee,
          montant_ligne: l.montant_ligne,
        })),
        updated: [],
        deleted: [],
      },
      anomalie: {
        created: anomalies.map((a) => ({
          uuid: a.uuid,
          programme_uuid: a.programme_uuid,
          plv_id: a.plv_id,
          type_anomalie: a.type_anomalie,
          gravite: a.gravite,
          description: a.description,
          statut: a.statut,
          date_heure: a.date_heure,
          latitude: a.latitude,
          longitude: a.longitude,
        })),
        updated: [],
        deleted: [],
      },
      photo: {
        created: photosMeta.map((p) => ({
          uuid: p.uuid,
          operation_uuid: p.operation_uuid,
          anomalie_uuid: p.anomalie_uuid,
          type_photo: p.type_photo,
          date_heure: p.date_heure,
          latitude: p.latitude,
          longitude: p.longitude,
          taille_octets: p.taille_octets,
        })),
        updated: [],
        deleted: [],
      },
    },
  };

  try {
    await apiClient.post('/api/sync/push/', payload);
  } catch (e: any) {
    return {
      success: false,
      pushed: empty,
      error: e?.response?.data?.detail ?? e?.message ?? 'Erreur reseau',
    };
  }

  await markTableSynced('operation',       operations.map((o) => o.uuid));
  await markTableSynced('ligne_operation', lignes.map((l) => l.uuid));
  await markTableSynced('anomalie',        anomalies.map((a) => a.uuid));
  await markPhotoMetaSynced(photosMeta.map((p) => p.uuid));

  await uploaderPhotosBinaires();

  return {
    success: true,
    pushed: {
      operation: operations.length,
      ligne_operation: lignes.length,
      anomalie: anomalies.length,
    },
  };
}

// ===========================================================================
// ORCHESTRATION
// ===========================================================================

/**
 * Synchronisation complete : push clotures → pull → push terrain.
 */
export async function syncAll(): Promise<{ pull: PullResult; push: PushResult }> {
  // Les clotures sont poussees AVANT le pull pour que le pull qui suit
  // ramene un statut CLOTURE coherent et n'ecrase pas la cloture locale.
  await pushClotures();
  const pullResult = await pull();
  const pushResult = await push();
  // Purge des données locales anciennes après une sync réussie.
  // On purge uniquement si pull ET push ont réussi pour ne pas supprimer
  // de données qui n'auraient pas encore été envoyées.
  if (pullResult.success && pushResult.success) {
    purgerDonneesAnciennes(90).catch(() => {});
  }
  return { pull: pullResult, push: pushResult };
}

/**
 * Remonte au serveur les programmes clotures localement.
 * Best-effort : en cas d'echec reseau, la cloture reste en attente et
 * sera retentee au prochain cycle.
 */
async function pushClotures(): Promise<void> {
  const uuids = await getCloturesPending();
  if (uuids.length === 0) return;
  try {
    await apiClient.post('/api/sync/programmes/cloturer/', { uuids });
    await clearCloturesPending(uuids);
  } catch (e) {
    console.warn('Push cloture echoue :', e);
  }
}

/**
 * Upload des fichiers binaires des photos dont la metadonnee est deja
 * remontee (sync_status SYNCED) mais le fichier pas encore (upload_status PENDING).
 * Best-effort : les echecs sont silencieux et reessayes au prochain cycle.
 */
async function uploaderPhotosBinaires(): Promise<void> {
  const photos = await getPhotosPendingUpload();
  if (photos.length === 0) return;

  const token = await getItem(STORAGE_KEYS.ACCESS_TOKEN);

  for (const photo of photos) {
    try {
      const info = await FileSystem.getInfoAsync(photo.local_uri);
      if (!info.exists) {
        // Le fichier local est introuvable (cache Android vidé avant correctif).
        // FILE_LOST ≠ DONE : le binaire n'est PAS sur le serveur.
        // La métadonnée est conservée ; la photo ne sera plus retentée.
        await markPhotoFileLost(photo.uuid);
        console.warn('[sync] photo FILE_LOST :', photo.uuid, photo.local_uri);
        continue;
      }

      const uploadUrl = `${API_BASE_URL}/api/sync/photos/${photo.uuid}/upload/`;
      const result = await FileSystem.uploadAsync(uploadUrl, photo.local_uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'fichier',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (result.status === 200) {
        await markPhotoUploaded(photo.uuid);
      }
    } catch (e) {
      console.warn('Upload photo echoue :', photo.uuid, e);
    }
  }
}
