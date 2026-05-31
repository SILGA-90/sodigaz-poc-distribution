/**
 * Service de capture et compression de photos.
 *
 * - prendrePhoto() : ouvre la camera
 * - choisirPhoto() : ouvre la galerie (pratique pour les tests)
 * Les deux retournent une image compressee (uri locale + taille).
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

export interface PhotoCapturee {
  uri: string;
  tailleOctets: number;
}

const LARGEUR_MAX = 1024;
const QUALITE = 0.6;

async function compresser(uri: string): Promise<PhotoCapturee> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: LARGEUR_MAX } }],
    { compress: QUALITE, format: ImageManipulator.SaveFormat.JPEG },
  );

  const info = await FileSystem.getInfoAsync(result.uri);
  const taille = info.exists && 'size' in info ? (info as any).size : 0;

  return { uri: result.uri, tailleOctets: taille };
}

export async function prendrePhoto(): Promise<PhotoCapturee | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission camera refusee.');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  return compresser(result.assets[0].uri);
}
