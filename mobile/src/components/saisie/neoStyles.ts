/**
 * Palette et styles de carte partagés entre les composants de la saisie.
 * Toutes les constantes visuelles néo-morphiques sont définies ici une seule
 * fois, importées par les composants de saisie pour garantir la cohérence.
 */
import { StyleSheet } from 'react-native';

export const NEO     = '#e8edf2';
export const NEO_SHD = '#4a6880';
export const NEO_IN  = '#d4dde6';
export const NAVY    = '#0a1628';
export const TEXT    = '#1a2a3a';
export const TEXT2   = '#3a5060';
export const TEXT3   = '#3a5060';
export const SEP     = '#c8d4de';

export const neoCard = StyleSheet.create({
  outer: {
    marginHorizontal: 12, marginBottom: 4, borderRadius: 14, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  inner: {
    borderRadius: 14, backgroundColor: NEO, padding: 14,
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 },
    shadowOpacity: 1, shadowRadius: 7,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  innerOverflow: {
    borderRadius: 14, backgroundColor: NEO, overflow: 'hidden',
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 },
    shadowOpacity: 1, shadowRadius: 7,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  fieldSep: { height: 1, backgroundColor: SEP, marginVertical: 12 },
});
