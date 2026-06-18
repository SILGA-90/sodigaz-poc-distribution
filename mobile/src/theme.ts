/**
 * Tokens de design SODIGAZ : source unique de vérité.
 *
 * Ce module exporte les constantes de design (couleurs, ombres, rayons)
 * utilisées dans tous les StyleSheet.create() de l'application mobile.
 * Aucune valeur hex ou taille ne doit être codée en dur dans un composant.
 *
 * Centraliser les tokens garantit la cohérence visuelle
 * entre tous les écrans et composants. Un changement de couleur de marque
 * se fait ici et se propage partout automatiquement.
 *
 * Couleurs de marque officielle SODIGAZ APC (extraites du logo) :
 *   - brandBlue   #079BD9 : bleu Sodigaz : couleur primaire, entêtes
 *   - brandOrange #EE7202 : orange APC : action principale, accent fort
 *   - brandAmber  #FAB848 : ambre de la flamme : dégradés, surbrillances
 *   - navy        #0a1628 : fond dark branded (écran de login, header)
 *
 * Sur un écran mobile en plein soleil,
 * les couleurs trop claires (gris clair sur blanc) deviennent illisibles.
 * textMuted est la couleur minimum autorisée pour du texte secondaire.
 *
 * React Native utilise des propriétés
 * shadow* sur iOS et elevation sur Android. Les deux valeurs sont
 * regroupées ici pour éviter de les répéter dans chaque StyleSheet.
 */
import { Dimensions } from 'react-native';

/**
 * Adapte une taille en points à la largeur d'écran réelle.
 *
 * Équivalent mobile du `rem` web : toutes les fontSize et certains
 * espacements passent par scale() au lieu d'être des px fixes.
 * Résultat plafonné à +40% pour éviter des textes disproportionnés
 * sur les très grandes tablettes.
 *
 * Base de référence : 375 pt (iPhone 14 mini), la taille de design
 * sur laquelle les maquettes sont calibrées. En dessous, les tailles
 * sont réduites proportionnellement (ex. petits écrans 360 px).
 */
const BASE_WIDTH = 375;
const SCREEN_WIDTH = Dimensions.get('window').width;
const _ratio = Math.min(SCREEN_WIDTH / BASE_WIDTH, 1.4);

export function scale(size: number): number {
  return Math.round(size * _ratio);
}

export const Colors = {
  // Marque SODIGAZ (couleurs officielles du logo)
  brandBlue:    '#079BD9',   // bleu Sodigaz : primaire
  brandBlueD:   '#0670A0',   // état pressé / ombre du bleu
  brandOrange:  '#EE7202',   // orange APC : action principale
  brandOrangeD: '#c45e00',   // état pressé / ombre de l'orange
  brandAmber:   '#FAB848',   // ambre de la flamme : dégradés
  navy:         '#0a1628',   // fond dark branded
  navyMid:      '#112240',   // variante navy légèrement plus claire

  // Sémantique (statuts, alertes)
  success:        '#16a34a',
  successBg:      '#dcfce7',
  successBorder:  '#86efac',
  danger:         '#dc2626',
  dangerBg:       '#fef2f2',
  dangerBorder:   '#fca5a5',
  warning:        '#d97706',
  warningBg:      '#fffbeb',
  warningBorder:  '#fcd34d',
  info:           '#079BD9',  // reprend brandBlue : cohérence marque/info
  infoBg:         '#e0f2fe',
  infoBorder:     '#7dd3fc',

  // Texte
  text:            '#0f172a',              // texte principal : contraste maximum
  textSub:         '#334155',              // texte secondaire
  textMuted:       '#64748b',              // libellés, métadonnées : min soleil
  textLight:       '#94a3b8',              // captions uniquement, jamais info critique
  textOnDark:      '#ffffff',
  textOnDarkSub:   'rgba(255,255,255,0.65)',
  textOnDarkMuted: 'rgba(255,255,255,0.4)',

  // Surfaces
  bg:          '#f0f4f8',   // fond d'écran (body)
  surface:     '#ffffff',   // cartes
  surface2:    '#f8fafc',   // surfaces secondaires
  inputBg:     '#f1f5f9',   // fond des champs de saisie
  border:      '#e2e8f0',   // bordures par défaut
  borderLight: '#f1f5f9',   // séparateurs

  // Indicateurs de synchronisation (pastilles sur EtapeCard)
  syncGreen:   '#22c55e',  // opération synchronisée
  syncPending: '#f97316',  // opération en attente de sync

  // Fond très clair du bleu de marque (chip code PLV, surbrillances)
  primaryLight: '#e3f3fb',

  // Rétrocompatibilité (aliases)
  successLight: '#dcfce7',
  dangerLight:  '#fef2f2',
  warningLight: '#fffbeb',
  background:   '#f0f4f8',
};

export const Shadow = {
  /** Ombre légère pour les cartes standard. */
  card: {
    shadowColor:   '#0f172a' as const,
    shadowOpacity: 0.07,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     3,
  },
  /** Ombre plus marquée pour les éléments flottants (modales, FAB). */
  elevated: {
    shadowColor:   '#0f172a' as const,
    shadowOpacity: 0.12,
    shadowRadius:  14,
    shadowOffset:  { width: 0, height: 4 },
    elevation:     6,
  },
};

export const Radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  pill: 999, // border-radius maximum : boutons arrondis, badges
};
