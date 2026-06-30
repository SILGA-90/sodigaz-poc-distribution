/**
 * Tokens et styles de carte partagés entre les composants saisie.
 * NEO_SHD gardé pour la compatibilité des composants pas encore refactorisés.
 */
import { StyleSheet } from 'react-native';

export const SURFACE = '#FFFFFF';
export const NEO     = '#F2F4F6';
export const NEO_SHD = '#4a6880';  // conservé — encore utilisé par les composants saisie en attente de refacto
export const NEO_IN  = '#E8EEF2';
export const NAVY    = '#0a1628';
export const TEXT    = '#1a2a3a';
export const TEXT2   = '#3a5060';
export const TEXT3   = '#5B6770';
export const SEP     = '#DDE2E6';

export const neoCard = StyleSheet.create({
  outer: {
    marginHorizontal: 12, marginBottom: 4, borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: '#DDE2E6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  inner: {
    borderRadius: 12, backgroundColor: SURFACE, padding: 14,
  },
  innerOverflow: {
    borderRadius: 12, backgroundColor: SURFACE, overflow: 'hidden',
  },
  fieldSep: { height: 1, backgroundColor: SEP, marginVertical: 12 },
});
