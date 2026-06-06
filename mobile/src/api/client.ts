/**
 * Client HTTP axios pre-configure.
 *
 * Inclut :
 *   - URL de base (API_BASE_URL)
 *   - Intercepteur request : ajoute le token JWT a chaque requete authentifiee
 *   - Intercepteur response : refresh automatique du token sur 401
 *     (une seule tentative de refresh, les requetes concurrentes sont mises
 *     en file d'attente jusqu'au resultat)
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import { API_BASE_URL } from '../config/api';
import { getItem, saveItem, removeItem, STORAGE_KEYS } from '../storage/secureStorage';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Intercepteur requete : injecte le Bearer token ──────────────────────────
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

// ── Gestion du refresh concurrent ───────────────────────────────────────────
// Une seule tentative de refresh a la fois ; les autres requetes en 401
// attendent le resultat avant d'etre rejouees ou annulees.
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

// ── Intercepteur reponse : refresh automatique sur 401 ──────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status: number | undefined = error.response?.status;
    const url: string = original?.url ?? '';

    // Ne pas boucler sur les endpoints d'authentification eux-memes
    const isAuthEndpoint =
      url.includes('/api/auth/login/') || url.includes('/api/auth/refresh/');

    if (status !== 401 || original._retry || isAuthEndpoint) {
      return Promise.reject(error);
    }

    original._retry = true;

    if (isRefreshing) {
      // File d'attente : la requete sera rejouee apres le refresh en cours
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
      if (!refreshToken) throw new Error('Session expiree — reconnectez-vous');

      // Appel direct axios (pas l'instance) pour eviter de re-declencher l'intercepteur
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
      // Les deux tokens sont invalides : l'utilisateur doit se reconnecter
      await removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      await removeItem(STORAGE_KEYS.REFRESH_TOKEN);
      return Promise.reject(new Error('Session expiree — reconnectez-vous'));
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;
