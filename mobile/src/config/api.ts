/**
 * Configuration de l'URL de l'API back-end.
 *
 * - En dev local sur navigateur (Expo Web) : localhost fonctionne car le
 *   navigateur et le serveur Django sont sur la meme machine.
 * - En dev sur telephone physique : il faudra remplacer par l'IP du PC
 *   sur le reseau local (ex. http://192.168.1.42:8000).
 *
 * Pour faciliter le changement, on lit EXPO_PUBLIC_API_URL depuis
 * l'environnement. Cree un fichier .env a la racine de mobile/ avec :
 *   EXPO_PUBLIC_API_URL=http://192.168.1.42:8000
 * Expo charge ce fichier automatiquement.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
