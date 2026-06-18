/**
 * Section paiement : deux variantes selon le type de programme.
 * - Collecte  : acompte optionnel (switch + montant + mode).
 * - Restitution : mode de paiement + montant total + encaissement.
 */
import React from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import NeoSelect from '../NeoSelect';
import SectionHeader from './SectionHeader';
import FieldInput from './FieldInput';
import { ModePaiement } from '../../types/models';
import { neoCard, NEO_IN, TEXT2, TEXT3 } from './neoStyles';

const MODES_PAIEMENT: { label: string; value: ModePaiement }[] = [
  { label: 'Espèces',      value: 'ESPECES' },
  { label: 'Mobile Money', value: 'MOBILE_MONEY' },
  { label: 'Chèque',       value: 'CHEQUE' },
  { label: 'Virement',     value: 'VIREMENT' },
  { label: 'Crédit',       value: 'CREDIT' },
];

interface Props {
  isCollecte:              boolean;
  modePaiement:            ModePaiement;
  onModePaiementChange:    (v: ModePaiement) => void;
  avecAcompte:             boolean;
  onAvecAcompteChange:     (v: boolean) => void;
  montantAcompte:          string;
  onMontantAcompteChange:  (v: string) => void;
  montantCalcule:          number;
  montantFinal:            number;
  montantManuel:           string;
  onMontantManuelChange:   (v: string) => void;
  montantCorrige:          boolean;
  onMontantCorrigeToggle:  () => void;
  estEncaissee:            boolean;
  onEstEncaisseeChange:    (v: boolean) => void;
}

export default function PaiementSection({
  isCollecte, modePaiement, onModePaiementChange,
  avecAcompte, onAvecAcompteChange, montantAcompte, onMontantAcompteChange,
  montantCalcule, montantManuel, onMontantManuelChange,
  montantCorrige, onMontantCorrigeToggle, estEncaissee, onEstEncaisseeChange,
}: Props): React.ReactElement {
  if (isCollecte) {
    return (
      <>
        <SectionHeader icon="cash-outline" color="orange" title="Acompte (optionnel)" />
        <View style={neoCard.outer}>
          <View style={neoCard.inner}>
            <View style={styles.switchRow}>
              <Text style={styles.label}>Le client verse un acompte ?</Text>
              <Switch
                value={avecAcompte}
                onValueChange={onAvecAcompteChange}
                trackColor={{ false: NEO_IN, true: Colors.brandOrange + '80' }}
                thumbColor={avecAcompte ? Colors.brandOrange : '#94a3b8'}
              />
            </View>
            {avecAcompte && (
              <>
                <View style={neoCard.fieldSep} />
                <Text style={styles.label}>Montant de l'acompte (FCFA)</Text>
                <FieldInput
                  value={montantAcompte}
                  onChangeText={(v) => onMontantAcompteChange(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
                <View style={neoCard.fieldSep} />
                <Text style={styles.label}>Mode de paiement</Text>
                <NeoSelect
                  value={modePaiement}
                  onChange={(v) => onModePaiementChange(v as ModePaiement)}
                  options={MODES_PAIEMENT}
                />
              </>
            )}
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <SectionHeader icon="cash-outline" color="green" title="Paiement" />
      <View style={neoCard.outer}>
        <View style={neoCard.inner}>
          <Text style={styles.label}>Mode de paiement</Text>
          <NeoSelect
            value={modePaiement}
            onChange={(v) => onModePaiementChange(v as ModePaiement)}
            options={MODES_PAIEMENT}
          />
          <View style={styles.montantRow}>
            <Text style={styles.label}>Montant total</Text>
            <TouchableOpacity onPress={onMontantCorrigeToggle}>
              <Text style={styles.toggleLink}>{montantCorrige ? '← Calcul auto' : 'Corriger ›'}</Text>
            </TouchableOpacity>
          </View>
          {montantCorrige ? (
            <FieldInput
              value={montantManuel}
              onChangeText={(v) => onMontantManuelChange(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder={String(montantCalcule)}
            />
          ) : (
            <View style={styles.montantAutoRow}>
              <Text style={styles.montantAutoValue}>{montantCalcule.toLocaleString('fr-FR')}</Text>
              <Text style={styles.montantAutoUnit}> FCFA</Text>
              <Text style={styles.montantAutoHint}> · calculé auto</Text>
            </View>
          )}
          <View style={neoCard.fieldSep} />
          <View style={styles.switchRow}>
            <View>
              <Text style={styles.label}>Montant encaissé ?</Text>
              <Text style={styles.switchSub}>Décocher si règlement différé</Text>
            </View>
            <Switch
              value={estEncaissee}
              onValueChange={onEstEncaisseeChange}
              trackColor={{ false: NEO_IN, true: Colors.success + '80' }}
              thumbColor={estEncaissee ? Colors.success : '#94a3b8'}
            />
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label:          { fontSize: scale(13), fontWeight: '700', color: TEXT2, marginTop: 2 },
  switchSub:      { fontSize: scale(11), color: TEXT3, marginTop: 1 },
  switchRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  montantRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  toggleLink:     { color: Colors.brandBlue, fontSize: scale(13), fontWeight: '600' },
  montantAutoRow:   { flexDirection: 'row', alignItems: 'baseline', marginTop: 8, marginBottom: 4 },
  montantAutoValue: { fontSize: scale(26), fontWeight: '800', color: Colors.success, letterSpacing: -0.5 },
  montantAutoUnit:  { fontSize: scale(14), fontWeight: '700', color: Colors.success },
  montantAutoHint:  { fontSize: scale(12), color: TEXT3 },
});
