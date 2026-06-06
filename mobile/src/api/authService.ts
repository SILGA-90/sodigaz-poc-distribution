/**
 * Service d'authentification : login, logout, recuperation du profil.
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
  const response = await apiClient.post<TokenPair>(
    '/api/auth/login/',
    credentials,
  );
  await saveItem(STORAGE_KEYS.ACCESS_TOKEN, response.data.access);
  await saveItem(STORAGE_KEYS.REFRESH_TOKEN, response.data.refresh);

  const me = await fetchMe();
  await saveItem(STORAGE_KEYS.USER_ID, String(me.id));
  // Chaque login repart d'un pull complet : le lastPulledAt du token precedent
  // peut appartenir a un autre utilisateur ou etre trop recent pour le nouvel
  // utilisateur dont les donnees ont ete creees avant ce timestamp.
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
