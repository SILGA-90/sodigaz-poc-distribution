/**
 * Types partagés entre SaisieOperationScreen et ses sous-composants.
 */
import { ArticleSaisie } from '../../db/repositories/saisieRepository';
import { ModePaiement } from '../../types/models';

export interface LigneState {
  produit:  ArticleSaisie;
  quantite: string;
}

export interface PaymentFields {
  montantTotal:       number;
  montantEncaisse:    number;
  encaissee:          boolean;
  modePaiementFinal:  ModePaiement | null;
}
