/**
 * Service d'authentification : login, logout, profil, accès développeur.
 *
 * Ce module expose les fonctions d'authentification utilisées par
 * l'app (LoginScreen, RootNavigator, DebugScreen) :
 *          - login()          : échange credentials contre tokens JWT + profil
 *          - logout()         : supprime les tokens du SecureStore
 *          - fetchMe()        : récupère le profil de l'utilisateur connecté
 *          - isAuthenticated() : vérifie la présence d'un access token
 *          - verifyDevAccess() : vérifie le PIN dev côté serveur
 *
 * WHY (setLastPulledAt(0) au login) : Chaque nouveau login repart d'un pull
 * complet (lastPulledAt = 0). Un timestamp residuel pourrait appartenir
 * à une session précédente d'un autre utilisateur (partage d'appareil)
 * ou être trop récent pour un utilisateur dont les données ont été
 * créées avant ce timestamp. Reset systématique = sécurité maximale.
 *
 * Le PIN dev ne doit JAMAIS être embarqué
 * dans le bundle JS (extractible par reverse engineering). La vérification
 * se fait exclusivement via /api/auth/dev-access/ + DEV_ACCESS_CODE
 * côté Django.
 */
import apiClient from './client';
import {
  LoginCredentials,
  TokenPair,
  UtilisateurInfo,
} from '../types/auth';
import { getItem, removeItem, saveItem, STORAGE_KEYS } from '../storage/secureStorage';
import { setLastPulledAt } from '../db/database';

export async function login(credentials: LoginCredentials): Promise<TokenPair> {
  const response = await apiClient.post<TokenPair>('/api/auth/login/', credentials);
  await saveItem(STORAGE_KEYS.ACCESS_TOKEN,  response.data.access);
  await saveItem(STORAGE_KEYS.REFRESH_TOKEN, response.data.refresh);
  const me = await fetchMe();
  await saveItem(STORAGE_KEYS.USER_ID, String(me.id));
  await setLastPulledAt(0);
  return response.data;
}

export async function logout(): Promise<void> {
  await removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  await removeItem(STORAGE_KEYS.REFRESH_TOKEN);
}

export async function fetchMe(): Promise<UtilisateurInfo> {
  const response = await apiClient.get<UtilisateurInfo>('/api/auth/me/');
  return response.data;
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getItem(STORAGE_KEYS.ACCESS_TOKEN);
  return token !== null;
}

/**
 * Vérifie le code d'accès au mode développeur (Debug BDD) côté serveur.
 * Le code n'est jamais stocké ni comparé dans l'app mobile.
 *
 * Distinguer "code invalide" (403) de "trop de
 * tentatives" (429) et d'"erreur réseau" permet à l'UI d'afficher un
 * message approprié à chaque cas : pas un générique "erreur".
 *
 * Retourne :
 *   "ok"      : code correct, accès autorisé
 *   "invalid" : code incorrect (compte dans le quota de 3/heure)
 *   "quota"   : quota dépassé (429) : réessayer dans 1 heure
 *   "error"   : erreur réseau ou serveur inattendue
 */
export async function verifyDevAccess(
  code: string,
): Promise<'ok' | 'invalid' | 'quota' | 'error'> {
  try {
    const response = await apiClient.post<{ ok: boolean }>(
      '/api/auth/dev-access/',
      { code },
    );
    return response.data.ok ? 'ok' : 'invalid';
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    if (status === 403) return 'invalid';
    if (status === 429) return 'quota';
    return 'error';
  }
}
