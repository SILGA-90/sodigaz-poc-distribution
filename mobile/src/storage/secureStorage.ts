/**
 * Couche d'abstraction sur le stockage sécurisé.
 *
 * Ce module centralise l'accès au stockage sécurisé de l'application.
 * Il expose trois fonctions (saveItem, getItem, removeItem) et les
 * clés STORAGE_KEYS utilisées dans l'app.
 *
 * Les tokens JWT (access + refresh)
 * doivent être stockés de façon sécurisée, hors de portée des autres
 * applications. expo-secure-store utilise le Keychain sur iOS et le
 * KeyStore sur Android : deux mécanismes de stockage chiffrés au niveau
 * de l'OS, indépendants du stockage applicatif.
 *
 * expo-secure-store n'est pas disponible
 * sur Expo Web. On utilise localStorage comme fallback de développement
 * uniquement : localStorage n'est PAS sécurisé (scripts XSS peuvent le
 * lire). Ce fallback est acceptable pour les tests sur navigateur, jamais
 * pour une production mobile.
 *
 * Centraliser les appels au stockage dans ce
 * module facilite un éventuel changement de bibliothèque (ex. passer de
 * expo-secure-store à react-native-keychain) sans toucher aux callers.
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

/** Clés de stockage sécurisé utilisées dans l'application. */
export const STORAGE_KEYS = {
  ACCESS_TOKEN:  'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER_ID:       'user_id',
} as const;
