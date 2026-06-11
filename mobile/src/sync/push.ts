/**
 * Synchronisation ascendante (mobile -> serveur).
 * Envoie les données PENDING et les fichiers photos au serveur.
 */
import { isAxiosError } from 'axios';
import apiClient from '../api/client';
import { getDatabase, getLastPulledAt } from '../db/database';
import {
  getPendingOperations,
  getPendingLignesOperation,
  getPendingAnomalies,
  markTableSynced,
} from '../db/repositories/operationRepository';
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
import { PushResult } from './types';

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
 * On ne marque SYNCED qu'après confirmation du serveur. Si le réseau coupe,
 * les données restent PENDING et seront renvoyées au prochain cycle
 * (idempotence garantie par update_or_create côté serveur).
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
export async function uploaderPhotosBinaires(): Promise<void> {
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
