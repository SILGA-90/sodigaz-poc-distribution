/**
 * Service de capture et compression de photos terrain.
 *
 * Ce module expose deux fonctions de capture photo :
 *   - prendrePhoto()  : ouvre la caméra du téléphone
 *   - choisirPhoto()  : ouvre la galerie (pratique pour les tests en démo)
 *
 *   Les deux fonctions compressent l'image et la déplacent vers un
 *   répertoire persistant (PHOTOS_DIR = documentDirectory/photos/).
 *
 * Les photos terrain (bordereau
 * signé, état PLV) n'ont pas besoin d'une résolution maximale : 1024 px
 * de large est suffisant pour lire les informations visuelles importantes.
 * La compression JPEG à 0.6 réduit typiquement le poids de 60-80 % par
 * rapport à l'original, ce qui accélère l'upload sur réseau mobile 3G/4G.
 *
 * ImageManipulator écrit le fichier
 * compressé dans le répertoire cache Android (getCacheDir()), qui peut
 * être vidé par l'OS en cas de pression mémoire. Les photos en attente
 * d'upload (sync_status PENDING) doivent survivre aux redémarrages et
 * aux vidanges de cache. On les déplace immédiatement vers
 * documentDirectory qui n'est supprimé qu'à la désinstallation de l'app.
 *
 * Permet de valider le flux photo en démo
 * sans avoir à prendre une vraie photo. Garde le même code de compression
 * et de persistance que prendrePhoto.
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

import { PHOTOS_DIR } from '../db/repositories/photoRepository';

export interface PhotoCapturee {
  uri:          string;
  tailleOctets: number;
}

// Largeur maximale de l'image compressée : 1024 px est suffisant pour la lecture
const LARGEUR_MAX = 1024;
// Qualité JPEG 0-1 : 0.6 réduit le poids de ~70 % sans dégradation visible
const QUALITE     = 0.6;

async function compresser(uri: string): Promise<PhotoCapturee> {
  const imageRef = await ImageManipulator.manipulate(uri)
    .resize({ width: LARGEUR_MAX })
    .renderAsync();
  const tmp = await imageRef.saveAsync({ compress: QUALITE, format: SaveFormat.JPEG });

  // Déplacer depuis le cache (temporaire) vers documentDirectory (persistant)
  await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  const filename      = tmp.uri.split('/').pop()!;
  const persistentUri = PHOTOS_DIR + filename;
  await FileSystem.copyAsync({ from: tmp.uri, to: persistentUri });
  await FileSystem.deleteAsync(tmp.uri, { idempotent: true });

  const info   = await FileSystem.getInfoAsync(persistentUri);
  const taille = info.exists && 'size' in info ? (info as { size: number }).size : 0;

  return { uri: persistentUri, tailleOctets: taille };
}

export async function prendrePhoto(): Promise<PhotoCapturee | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission caméra refusée.');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    quality:    1, // pleine qualité avant compression dans compresser()
  });
  if (result.canceled || !result.assets[0]) return null;
  return compresser(result.assets[0].uri);
}

export async function choisirPhoto(): Promise<PhotoCapturee | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission galerie refusée.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality:    1,
  });
  if (result.canceled || !result.assets[0]) return null;
  return compresser(result.assets[0].uri);
}
