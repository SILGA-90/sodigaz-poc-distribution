/**
 * Types TypeScript liés à l'authentification JWT.
 *
 * Interfaces partagées entre authService, loginScreen et RootNavigator
 * pour les credentials, les tokens et le profil utilisateur.
 *
 * L'identifiant terrain
 * est le code livreur (ex. LIV001), pas un nom de compte administratif.
 * Cela correspond au champ `code_livreur` du modèle Utilisateur Django
 * et est plus naturel pour un livreur sur le terrain.
 *
 * Le rôle est inclus dans
 * le token JWT (claim supplémentaire) et dans la réponse /api/auth/me/.
 * Il permet à l'app mobile de vérifier que l'utilisateur connecté est
 * bien un livreur et non un superviseur qui se connecte par erreur.
 */

export interface LoginCredentials {
  code_livreur: string;
  password: string;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface UtilisateurInfo {
  id: number;
  username: string;
  code_livreur: string | null;
  first_name: string;
  last_name: string;
  telephone: string;
  role: 'LIVREUR' | 'SUPERVISEUR' | 'ADMIN';
  is_active: boolean;
}
