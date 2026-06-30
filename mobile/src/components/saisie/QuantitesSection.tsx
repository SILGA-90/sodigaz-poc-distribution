/**
 * Section articles : liste les produits saisissables avec leur stepper
 * +/- et le champ de saisie de quantité.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import SectionHeader from './SectionHeader';
import { LigneState } from './types';
import { neoCard, NEO_IN, SEP, TEXT, TEXT3 } from './neoStyles';

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
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; if (c > 0) onUpdateQuantite(index, String(c - 1)); }}
                  activeOpacity={0.82}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.qteInput}
                  value={ligne.quantite}
                  onChangeText={(v) => onUpdateQuantite(index, v)}
                  keyboardType="number-pad"
                  maxLength={4}
                  textAlign="center"
                />
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; onUpdateQuantite(index, String(c + 1)); }}
                  activeOpacity={0.82}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
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
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 44, height: 48, borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#DDE2E6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { fontSize: scale(26), fontWeight: '700', color: TEXT, lineHeight: 30 },
  qteInput: {
    width: 56, height: 48, borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#DDE2E6',
    fontSize: scale(18), fontWeight: '700', color: TEXT, textAlign: 'center',
  },
});
