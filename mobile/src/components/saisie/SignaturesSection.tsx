/**
 * Section signatures : nom du signataire, bandeau d'erreur si manquantes,
 * et deux boutons (livreur / client) pour ouvrir le pad de signature.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, scale } from '../../theme';
import SectionHeader from './SectionHeader';
import FieldInput from './FieldInput';
import { neoCard, TEXT2, TEXT3 } from './neoStyles';

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
                  activeOpacity={0.82}
                >
                  <Ionicons
                    name={signed ? 'checkmark-circle' : 'create-outline'}
                    size={22}
                    color={missing ? Colors.danger : signed ? Colors.success : TEXT3}
                    style={{ marginBottom: 5 }}
                  />
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
  label: { fontSize: scale(13), fontWeight: '700', color: TEXT2, marginTop: 2 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginBottom: 12, padding: 11, borderRadius: 10,
    backgroundColor: Colors.dangerBg,
    borderWidth: 1, borderColor: Colors.dangerBorder,
  },
  errorText: { flex: 1, fontSize: scale(13), color: Colors.danger, lineHeight: 18 },

  sigRow: { flexDirection: 'row', gap: 10 },
  sigBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#DDE2E6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  sigBtnDone:  { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  sigBtnError: { backgroundColor: Colors.dangerBg,  borderColor: Colors.dangerBorder },

  sigLabel:      { fontSize: scale(13), fontWeight: '700', color: TEXT2 },
  sigLabelDone:  { color: Colors.success },
  sigLabelError: { color: Colors.danger },
  sigSub:      { fontSize: scale(10), color: TEXT3, marginTop: 2, textAlign: 'center' },
  sigSubDone:  { color: Colors.success },
  sigSubError: { color: Colors.danger, fontWeight: '700' },
});
