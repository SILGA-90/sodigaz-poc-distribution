/**
 * Types des entites metier cote mobile.
 *
 * Ces types refletent le modele Django, mais ne contiennent que ce dont
 * le mobile a besoin. Les ForeignKey sont representees par l'id serveur
 * (number) pour les referentiels, et par uuid pour les entites synchronisees.
 *
 * Convention : tous les champs de synchronisation (uuid, last_modified,
 * is_deleted) suivent le meme schema que cote serveur.
 */

export type TypeProgramme = 'COLLECTE' | 'RESTITUTION';
export type StatutProgramme = 'PLANIFIE' | 'EN_COURS' | 'CLOTURE';
export type StatutVisite = 'A_VISITER' | 'VISITEE' | 'ECHEC';
export type TypeOperation = 'COLLECTE' | 'RESTITUTION' | 'LIVRAISON_DIRECTE' | 'CONSIGNE';
export type SousTypeCollecte = 'BCR' | 'BCT' | null;
export type ModePaiement = 'ESPECES' | 'MOBILE_MONEY' | 'CHEQUE' | 'VIREMENT' | 'CREDIT' | null;
export type StatutAnomalie = 'OUVERTE' | 'EN_TRAITEMENT' | 'RESOLUE';
export type GraviteAnomalie = 'FAIBLE' | 'MOYENNE' | 'ELEVEE';

// ---- Referentiels (lecture seule, recus du serveur) ----

export interface Client {
  id: number;
  code_x3: string;
  raison_sociale: string;
  type_client: string;
  contact: string;
  telephone: string;
  actif: number; // SQLite n'a pas de booleen : 0 ou 1
}

export interface Plv {
  id: number;
  client_id: number;
  libelle: string;
  adresse: string;
  latitude: number;
  longitude: number;
  statut: string;
}

export interface Produit {
  id: number;
  code_x3: string;
  libelle: string;
  type_emballage: string;
  prix_unitaire: number;
  montant_consignation: number;
  actif: number;
}

// ---- Tables semi-synchronisees (pull) ----

export interface Programme {
  id: number;
  uuid: string;
  numero_x3: string;
  utilisateur_id: number;
  vehicule_id: number | null;
  date_programme: string; // ISO date 'YYYY-MM-DD'
  type_programme: TypeProgramme;
  statut: StatutProgramme;
  heure_debut: string | null;
  heure_fin: string | null;
  last_modified: number;
  is_deleted: number;
}

export interface Etape {
  id: number;
  uuid: string;
  programme_id: number;
  plv_id: number;
  ordre_prevu: number;
  ordre_optimise: number | null;
  statut_visite: StatutVisite;
  last_modified: number;
  is_deleted: number;
}

export interface LigneProgramme {
  id: number;
  uuid: string;
  etape_id: number;
  produit_id: number;
  quantite_prevue: number;
  last_modified: number;
  is_deleted: number;
}

// ---- Tables push (creees sur le mobile) ----

export interface Operation {
  uuid: string;            // cle primaire cote mobile (genere localement)
  etape_uuid: string;      // reference l'etape par uuid
  type_operation: TypeOperation;
  sous_type: SousTypeCollecte;
  date_heure: string;      // ISO datetime
  latitude: number | null;
  longitude: number | null;
  mode_paiement: ModePaiement;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: number;
  signature_livreur: string;
  signature_client: string;
  nom_signataire_client: string;
  commentaire: string;
  // Champs de synchro locale
  sync_status: 'PENDING' | 'SYNCED'; // PENDING = pas encore remonte au serveur
  last_modified: number;
  is_deleted: number;
}

export interface LigneOperation {
  uuid: string;
  operation_uuid: string;
  produit_code_x3: string;  // le mobile reference le produit par code_x3
  quantite_realisee: number;
  quantite_collectee_vide: number;
  quantite_consignee: number;
  quantite_deconsignee: number;
  montant_ligne: number;
  sync_status: 'PENDING' | 'SYNCED';
  last_modified: number;
  is_deleted: number;
}

export interface Anomalie {
  uuid: string;
  programme_uuid: string;
  plv_id: number | null;
  type_anomalie: string;
  gravite: GraviteAnomalie;
  description: string;
  statut: StatutAnomalie;
  date_heure: string;
  latitude: number | null;
  longitude: number | null;
  sync_status: 'PENDING' | 'SYNCED';
  last_modified: number;
  is_deleted: number;
}
