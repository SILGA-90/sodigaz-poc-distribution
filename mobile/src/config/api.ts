/**
 * Configuration de l'URL de l'API back-end Django.
 *
 * Ce module exporte API_BASE_URL, l'adresse du serveur Django utilisée
 * par le client Axios. L'URL est lue depuis la variable d'environnement
 * EXPO_PUBLIC_API_URL (définie dans mobile/.env).
 *
 * L'IP du serveur change à chaque réseau Wi-Fi
 * (WSL2 / réseau local). Externaliser cette valeur dans .env permet de
 * la changer sans modifier le code. Le préfixe EXPO_PUBLIC_ est
 * obligatoire pour qu'Expo injecte la variable dans le bundle JS.
 *
 * Permet de lancer l'app sur Expo Web (navigateur
 * sur le même PC que Django) sans .env configuré. Sur téléphone physique,
 * localhost pointe vers le téléphone lui-même : il faut impérativement
 * définir EXPO_PUBLIC_API_URL avec l'IP Windows (voir CLAUDE.md §6).
 *
 * Les endpoints sont définis avec leur chemin
 * complet dans les services (ex. '/api/auth/login/'). Inclure /api/
 * dans la base crée de la confusion quand on navigue vers des endpoints
 * non-API (photos, admin).
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
