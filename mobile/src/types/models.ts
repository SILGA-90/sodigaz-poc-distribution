/**
 * Types des entités métier côté mobile.
 *
 * Ce module définit les interfaces TypeScript qui décrivent les
 * données stockées dans SQLite et échangées avec le serveur Django.
 * Il existe une interface par table de la base locale.
 *
 * Les types reflètent
 * fidèlement les modèles Django, mais n'exposent que les champs
 * nécessaires au mobile. Les FK sont représentées par l'id serveur
 * (number) pour les référentiels, et par UUID (string) pour les
 * entités synchronisées en écriture.
 *
 * SQLite ne possède pas de type
 * BOOLEAN natif : les valeurs booléennes sont stockées en INTEGER
 * (0 ou 1). Typer en `number` est cohérent avec ce que SQLite retourne.
 *
 * Seules les tables push (créées
 * mobile) ont un sync_status. PENDING = l'enregistrement doit être
 * envoyé au serveur lors du prochain push. SYNCED = le serveur a
 * confirmé la réception (200 OK). On ne passe jamais PENDING -> SYNCED
 * localement ; uniquement après confirmation serveur.
 *
 * Le mobile identifie les
 * articles par leur code X3 (stable et lisible), pas par l'id interne
 * Django qui n'a de sens que côté serveur.
 */

export type TypeProgramme    = 'COLLECTE' | 'RESTITUTION';
export type StatutProgramme  = 'PLANIFIE' | 'EN_COURS' | 'CLOTURE';
export type StatutVisite     = 'A_VISITER' | 'VISITEE' | 'ECHEC';
export type TypeOperation    = 'COLLECTE' | 'RESTITUTION' | 'LIVRAISON_DIRECTE' | 'CONSIGNE';
export type SousTypeCollecte = 'BCR' | 'BCT' | null;
export type ModePaiement     = 'ESPECES' | 'MOBILE_MONEY' | 'CHEQUE' | 'VIREMENT' | 'CREDIT' | null;
export type StatutAnomalie   = 'OUVERTE' | 'EN_TRAITEMENT' | 'RESOLUE';
export type GraviteAnomalie  = 'FAIBLE' | 'MOYENNE' | 'ELEVEE';

// ---------------------------------------------------------------------------
// 1. Référentiels (lecture seule, reçus du serveur via pull)
// ---------------------------------------------------------------------------

export interface Client {
  id:              number;
  code_x3:         string;
  raison_sociale:  string;
  type_client:     string;
  contact:         string;
  telephone:       string;
  actif:           number; // 0 ou 1 : SQLite n'a pas de BOOLEAN
}

export interface Plv {
  id:         number;
  client_id:  number;
  libelle:    string;
  adresse:    string;
  latitude:   number;
  longitude:  number;
  statut:     string;
}

export interface Article {
  id:                   number;
  code_x3:              string;
  libelle:              string;
  type_emballage:       string;
  prix_unitaire:        number;
  montant_consignation: number;
  actif:                number;
}

// ---------------------------------------------------------------------------
// 2. Tables semi-synchronisées (créées serveur, pull mobile)
// ---------------------------------------------------------------------------

export interface Programme {
  id:              number;
  uuid:            string;
  numero_x3:       string;
  utilisateur_id:  number;
  vehicule_id:     number | null;
  date_programme:  string; // ISO date 'YYYY-MM-DD'
  type_programme:  TypeProgramme;
  statut:          StatutProgramme;
  heure_debut:     string | null;
  heure_fin:       string | null;
  last_modified:   number;
  is_deleted:      number;
}

export interface Etape {
  id:              number;
  uuid:            string;
  programme_id:    number;
  plv_id:          number;
  ordre_prevu:     number;
  ordre_optimise:  number | null;
  statut_visite:   StatutVisite;
  last_modified:   number;
  is_deleted:      number;
}

export interface LigneProgramme {
  id:               number;
  uuid:             string;
  etape_id:         number;
  produit_id:       number;
  quantite_prevue:  number;
  last_modified:    number;
  is_deleted:       number;
}

// ---------------------------------------------------------------------------
// 3. Tables push (créées sur le mobile, remontées au serveur)
// ---------------------------------------------------------------------------

export interface Operation {
  uuid:                  string; // clé primaire mobile (Crypto.randomUUID())
  etape_uuid:            string; // référence l'étape par UUID
  type_operation:        TypeOperation;
  sous_type:             SousTypeCollecte;
  date_heure:            string; // ISO datetime
  latitude:              number | null;
  longitude:             number | null;
  mode_paiement:         ModePaiement;
  montant_total:         number;
  montant_encaisse:      number;
  est_encaissee:         number; // 0 ou 1
  gps_precision:         number | null;
  gps_horodatage:        string | null;
  signature_livreur:     string;
  signature_client:      string;
  nom_signataire_client: string;
  commentaire:           string;
  sync_status:           'PENDING' | 'SYNCED';
  last_modified:         number;
  is_deleted:            number;
}

export interface LigneOperation {
  uuid:                     string;
  operation_uuid:           string;
  produit_code_x3:          string; // identifiant métier stable : pas l'id Django
  quantite_realisee:        number;
  quantite_collectee_vide:  number;
  quantite_consignee:       number;
  quantite_deconsignee:     number;
  montant_ligne:            number;
  sync_status:              'PENDING' | 'SYNCED';
  last_modified:            number;
  is_deleted:               number;
}

export interface Anomalie {
  uuid:            string;
  programme_uuid:  string;
  plv_id:          number | null;
  type_anomalie:   string;
  gravite:         GraviteAnomalie;
  description:     string;
  statut:          StatutAnomalie;
  date_heure:      string;
  latitude:        number | null;
  longitude:       number | null;
  sync_status:     'PENDING' | 'SYNCED';
  last_modified:   number;
  is_deleted:      number;
}
