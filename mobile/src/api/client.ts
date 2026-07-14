/**
 * Client HTTP axios pré-configuré.
 *
 * Ce module crée une instance axios partagée par tous les services
 * (authService, syncService...). Il configure :
 *          - L'URL de base (EXPO_PUBLIC_API_URL via config/api.ts)
 *          - Un timeout de 10 secondes
 *          - L'injection automatique du Bearer token JWT à chaque requête
 *          - Le refresh automatique du token sur erreur 401
 *
 * Chaque service n'a pas besoin de lire
 * lui-même le token stocké : l'intercepteur request le fait
 * transparentement pour toutes les requêtes.
 *
 * Le token access JWT expire après
 * 5 minutes (voir settings.py). Sans refresh automatique, le livreur
 * serait renvoyé vers le login après 5 minutes d'inactivité, même avec
 * une session active. Le refresh transparent assure une continuité
 * d'utilisation pendant toute la tournée.
 *
 * Si plusieurs requêtes échouent
 * avec 401 simultanément (ex. pull + push en parallèle), une seule
 * tentative de refresh est faite. Les autres requêtes attendent le
 * résultat via failedQueue avant d'être rejouées ou rejetées.
 * Sans cette mécanique, chaque requête ferait son propre refresh,
 * provoquant une course condition sur les tokens.
 *
 * L'appel de refresh
 * ne doit pas passer par l'intercepteur de l'instance apiClient :
 * cela créerait une boucle infinie si le refresh échoue lui-même en 401.
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import { API_BASE_URL } from '../config/api';
import { getItem, saveItem, removeItem, STORAGE_KEYS } from '../storage/secureStorage';
import { navigateToLogin } from '../navigation/navigationRef';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
});

// Intercepteur requête : injection du Bearer token
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getItem(STORAGE_KEYS.ACCESS_TOKEN);
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// File d'attente pour les 401 concurrents
// Une seule tentative de refresh à la fois ; les autres requêtes en 401
// attendent le résultat avant d'être rejouées ou annulées.
let isRefreshing = false;
type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void };
let failedQueue: QueueEntry[] = [];

function flushQueue(error: unknown, token: string | null): void {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
}

// Intercepteur réponse : refresh automatique sur 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status: number | undefined = error.response?.status;
    const url: string = original?.url ?? '';

    // Ne pas boucler sur les endpoints d'authentification eux-mêmes
    const isAuthEndpoint =
      url.includes('/api/auth/login/') || url.includes('/api/auth/refresh/');

    if (status !== 401 || original._retry || isAuthEndpoint) {
      return Promise.reject(error);
    }

    original._retry = true;

    if (isRefreshing) {
      // Mettre en file : la requête sera rejouée après le refresh en cours
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((newToken) => {
        if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      });
    }

    isRefreshing = true;
    try {
      const refreshToken = await getItem(STORAGE_KEYS.REFRESH_TOKEN);
      if (!refreshToken) throw new Error('Session expirée : reconnectez-vous');

      // Appel direct axios (pas l'instance) pour éviter de re-déclencher l'intercepteur
      const resp = await axios.post<{ access: string }>(
        `${API_BASE_URL}/api/auth/refresh/`,
        { refresh: refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const newAccessToken = resp.data.access;
      await saveItem(STORAGE_KEYS.ACCESS_TOKEN, newAccessToken);

      flushQueue(null, newAccessToken);
      if (original.headers) original.headers.Authorization = `Bearer ${newAccessToken}`;
      return apiClient(original);
    } catch (refreshErr) {
      flushQueue(refreshErr, null);
      // Les deux tokens sont invalides : vider le stockage et renvoyer vers Login
      await removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      await removeItem(STORAGE_KEYS.REFRESH_TOKEN);
      navigateToLogin();
      return Promise.reject(new Error('Session expirée : reconnectez-vous'));
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;
