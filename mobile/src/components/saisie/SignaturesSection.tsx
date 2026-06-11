/**
 * Section signatures : nom du signataire, bandeau d'erreur si manquantes,
 * et deux boutons (livreur / client) pour ouvrir le pad de signature.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme';
import SectionHeader from './SectionHeader';
import FieldInput from './FieldInput';
import { neoCard, NEO, NEO_SHD, TEXT2, TEXT3 } from './neoStyles';

interface Props {
  nomSignataire:        string;
  onNomSignataireChange: (v: string) => void;
  signatureLivreur:     string;
  signatureClient:      string;
  showSigError:         boolean;
  onOpenPad:            (who: 'LIVREUR' | 'CLIENT') => void;
  onClearSigError:      () => void;
}

export default function SignaturesSection({
  nomSignataire, onNomSignataireChange,
  signatureLivreur, signatureClient,
  showSigError, onOpenPad, onClearSigError,
}: Props): React.ReactElement {
  const sigErrMsg =
    !signatureLivreur && !signatureClient ? "Les deux signatures sont obligatoires avant d'enregistrer."
    : !signatureLivreur                   ? 'La signature du livreur est obligatoire.'
    :                                       'La signature du client est obligatoire.';

  return (
    <>
      <SectionHeader icon="create-outline" color="navy" title="Signatures" />
      <View style={neoCard.outer}>
        <View style={neoCard.inner}>
          <Text style={styles.label}>Nom du signataire (client)</Text>
          <FieldInput value={nomSignataire} onChangeText={onNomSignataireChange} placeholder="Nom complet du client" />
          <View style={neoCard.fieldSep} />
          {showSigError && (!signatureLivreur || !signatureClient) && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} style={{ marginTop: 1 }} />
              <Text style={styles.errorText}>{sigErrMsg}</Text>
            </View>
          )}
          <View style={styles.sigRow}>
            {(['LIVREUR', 'CLIENT'] as const).map((who) => {
              const signed  = who === 'LIVREUR' ? !!signatureLivreur : !!signatureClient;
              const missing = showSigError && !signed;
              return (
                <TouchableOpacity
                  key={who}
                  style={[styles.sigBtn, signed && styles.sigBtnDone, missing && styles.sigBtnError]}
                  onPress={() => { onClearSigError(); onOpenPad(who); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sigIcon, signed && styles.sigIconDone, missing && styles.sigIconError]}>
                    {signed ? '✓' : '✎'}
                  </Text>
                  <Text style={[styles.sigLabel, signed && styles.sigLabelDone, missing && styles.sigLabelError]}>
                    {who === 'LIVREUR' ? 'Livreur' : 'Client'}
                  </Text>
                  <Text style={[styles.sigSub, signed && styles.sigSubDone, missing && styles.sigSubError]}>
                    {signed ? 'Signé' : missing ? 'Obligatoire !' : 'Appuyer pour signer'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: TEXT2, marginTop: 2 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginBottom: 12, padding: 11, borderRadius: 10,
    backgroundColor: Colors.dangerBg,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#fdd', borderLeftColor: '#fdd',
    borderBottomColor: Colors.dangerBorder, borderRightColor: Colors.dangerBorder,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.danger, lineHeight: 18 },

  sigRow: { flexDirection: 'row', gap: 10 },
  sigBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center',
    backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 7,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  sigBtnDone: {
    backgroundColor: Colors.successBg, shadowColor: '#107a30', shadowOpacity: 0.4,
    borderTopColor: 'rgba(210,255,230,0.8)', borderLeftColor: 'rgba(210,255,230,0.8)',
    borderBottomColor: Colors.successBorder, borderRightColor: Colors.successBorder,
  },
  sigBtnError: {
    backgroundColor: Colors.dangerBg, shadowColor: '#991b1b', shadowOpacity: 0.35,
    borderTopColor: '#fdd', borderLeftColor: '#fdd',
    borderBottomColor: Colors.dangerBorder, borderRightColor: Colors.dangerBorder,
  },
  sigIcon:      { fontSize: 22, marginBottom: 5, color: TEXT3 },
  sigIconDone:  { color: Colors.success },
  sigIconError: { color: Colors.danger },
  sigLabel:      { fontSize: 13, fontWeight: '700', color: TEXT2 },
  sigLabelDone:  { color: Colors.success },
  sigLabelError: { color: Colors.danger },
  sigSub:      { fontSize: 10, color: TEXT3, marginTop: 2, textAlign: 'center' },
  sigSubDone:  { color: Colors.success },
  sigSubError: { color: Colors.danger, fontWeight: '700' },
});
