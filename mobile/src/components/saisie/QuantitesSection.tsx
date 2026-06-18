/**
 * Section articles : liste les produits saisissables avec leur stepper
 * +/- et le champ de saisie de quantité.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import SectionHeader from './SectionHeader';
import { LigneState } from './types';
import { neoCard, NEO, NEO_IN, NEO_SHD, SEP, TEXT, TEXT3 } from './neoStyles';

interface Props {
  isCollecte:      boolean;
  lignes:          LigneState[];
  onUpdateQuantite: (index: number, valeur: string) => void;
}

export default function QuantitesSection({ isCollecte, lignes, onUpdateQuantite }: Props): React.ReactElement {
  return (
    <>
      <SectionHeader
        icon={isCollecte ? 'arrow-down-outline' : 'arrow-up-outline'}
        color="blue"
        title={isCollecte ? 'Bouteilles à collecter' : 'Quantités à livrer'}
      />
      <View style={neoCard.outer}>
        <View style={neoCard.inner}>
          {lignes.map((ligne, index) => (
            <View key={`${ligne.produit.code_x3}_${index}`} style={[styles.ligneRow, index > 0 && styles.ligneRowSep]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.libelle}>{ligne.produit.libelle}</Text>
                <View style={styles.meta}>
                  <View style={styles.codeBadge}>
                    <Text style={styles.codeBadgeText}>{ligne.produit.code_x3}</Text>
                  </View>
                  {!isCollecte && (
                    <Text style={styles.prix}>{ligne.produit.prix_unitaire.toLocaleString('fr-FR')} F/u</Text>
                  )}
                  {ligne.produit.quantite_prevue != null && (
                    <View style={styles.prevueBadge}>
                      <Text style={styles.prevueBadgeText}>Prévu : {ligne.produit.quantite_prevue}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.stepper}>
                <View style={styles.stepOuter}>
                  <TouchableOpacity
                    style={styles.stepInner}
                    onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; if (c > 0) onUpdateQuantite(index, String(c - 1)); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.stepBtnText}>−</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.qteInput}
                  value={ligne.quantite}
                  onChangeText={(v) => onUpdateQuantite(index, v)}
                  keyboardType="number-pad"
                  maxLength={4}
                  textAlign="center"
                />
                <View style={styles.stepOuter}>
                  <TouchableOpacity
                    style={styles.stepInner}
                    onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; onUpdateQuantite(index, String(c + 1)); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.stepBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  ligneRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  ligneRowSep: { borderTopWidth: 1, borderTopColor: SEP },
  libelle:     { fontSize: scale(14), fontWeight: '700', color: TEXT },
  meta:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  codeBadge:     { backgroundColor: NEO_IN, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  codeBadgeText: { fontSize: scale(11), fontWeight: '600', color: TEXT3 },
  prix:          { fontSize: scale(11), color: TEXT3 },
  prevueBadge:     { backgroundColor: Colors.infoBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  prevueBadgeText: { fontSize: scale(11), fontWeight: '700', color: Colors.brandBlue },
  stepper:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepOuter: {
    borderRadius: 10, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1, shadowRadius: 5, elevation: 6,
  },
  stepInner: {
    width: 44, height: 48, borderRadius: 10, backgroundColor: NEO,
    shadowColor: '#ffffff', shadowOffset: { width: -3, height: -3 },
    shadowOpacity: 1, shadowRadius: 4,
    alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  stepBtnText: { fontSize: scale(26), fontWeight: '700', color: TEXT, lineHeight: 30 },
  qteInput: {
    width: 56, height: 48, borderRadius: 10, backgroundColor: NEO_IN,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#a8bac8', borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
    fontSize: scale(18), fontWeight: '700', color: TEXT, textAlign: 'center',
  },
});
