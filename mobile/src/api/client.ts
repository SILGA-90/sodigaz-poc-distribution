/**
 * Client HTTP axios pre-configure.
 *
 * Inclut :
 *   - URL de base (API_BASE_URL)
 *   - Intercepteur qui ajoute le token JWT a chaque requete authentifiee
 *   - (Sprint 2) Intercepteur qui rafraichit le token sur 401
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import { API_BASE_URL } from '../config/api';
import { getItem, STORAGE_KEYS } from '../storage/secureStorage';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur : ajoute le token JWT a chaque requete sortante
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

export default apiClient;
