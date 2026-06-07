/**
 * Service de capture et compression de photos.
 *
 * - prendrePhoto() : ouvre la camera
 * - choisirPhoto() : ouvre la galerie (pratique pour les tests)
 * Les deux retournent une image compressee stockée dans PHOTOS_DIR
 * (documentDirectory/photos/), jamais dans le cache Android.
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

import { PHOTOS_DIR } from '../db/repositories/photoRepository';

export interface PhotoCapturee {
  uri: string;
  tailleOctets: number;
}

const LARGEUR_MAX = 1024;
const QUALITE = 0.6;

async function compresser(uri: string): Promise<PhotoCapturee> {
  const imageRef = await ImageManipulator.manipulate(uri)
    .resize({ width: LARGEUR_MAX })
    .renderAsync();
  const tmp = await imageRef.saveAsync({ compress: QUALITE, format: SaveFormat.JPEG });

  // ImageManipulator écrit dans getCacheDir() Android — emplacement temporaire.
  // On déplace immédiatement vers PHOTOS_DIR (documentDirectory) qui est
  // persistant : non vidé par l'OS, survit aux redémarrages, supprimé uniquement
  // lors de la désinstallation.
  await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  const filename = tmp.uri.split('/').pop()!;
  const persistentUri = PHOTOS_DIR + filename;
  await FileSystem.copyAsync({ from: tmp.uri, to: persistentUri });
  await FileSystem.deleteAsync(tmp.uri, { idempotent: true });

  const info = await FileSystem.getInfoAsync(persistentUri);
  const taille = info.exists && 'size' in info ? (info as any).size : 0;

  return { uri: persistentUri, tailleOctets: taille };
}

export async function prendrePhoto(): Promise<PhotoCapturee | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission camera refusee.');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  return compresser(result.assets[0].uri);
}

export async function choisirPhoto(): Promise<PhotoCapturee | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission galerie refusee.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  return compresser(result.assets[0].uri);
}
