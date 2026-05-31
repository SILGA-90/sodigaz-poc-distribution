/**
 * Couche d'abstraction sur le stockage securise.
 *
 * - Sur mobile (iOS/Android) : utilise expo-secure-store (Keychain sur iOS,
 *   KeyStore sur Android), qui chiffre les valeurs au niveau de l'OS.
 * - Sur web : expo-secure-store n'est pas disponible. On retombe sur
 *   localStorage, qui n'est PAS securise (un script malveillant pourrait
 *   le lire). Acceptable pour le developpement Expo Web, surtout pas
 *   pour la production.
 *
 * Pour la version mobile cible, c'est expo-secure-store qui sera utilise.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

export async function saveItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

// Cles utilisees dans l'app
export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const;
