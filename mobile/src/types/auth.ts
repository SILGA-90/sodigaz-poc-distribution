/**
 * Types lies a l'authentification JWT.
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
