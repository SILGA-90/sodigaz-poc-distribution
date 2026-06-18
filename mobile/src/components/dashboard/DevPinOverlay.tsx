/**
 * Overlay de saisie du PIN développeur.
 * Fond sombre intentionnel (#0d1e35) même dans le thème néo clair :
 * le contraste fort signale visuellement une "zone sécurisée" et aide à
 * lire le clavier PIN en plein soleil. Voir CLAUDE.md §5.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';

interface Props {
  visible:          boolean;
  pinInput:         string;
  pinLoading:       boolean;
  onChangePinInput: (v: string) => void;
  onCancel:         () => void;
  onConfirm:        () => void;
}

export default function DevPinOverlay({ visible, pinInput, pinLoading, onChangePinInput, onCancel, onConfirm }: Props): React.ReactElement | null {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Mode développeur</Text>
        <Text style={styles.sub}>Entrez le code d'accès</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={pinInput}
            onChangeText={onChangePinInput}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            autoFocus
            placeholder="• • • •"
            placeholderTextColor="rgba(255,255,255,0.25)"
          />
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmBtn, pinLoading && { opacity: 0.6 }]}
            onPress={onConfirm}
            disabled={pinLoading}
          >
            {pinLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.confirmText}>Valider</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center' },
  card:       { width: 300, backgroundColor: '#0d1e35', borderRadius: 24, padding: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  title:      { fontSize: scale(17), fontWeight: '700', color: '#fff', textAlign: 'center' },
  sub:        { fontSize: scale(13), color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  inputWrap:  { backgroundColor: '#091527', borderRadius: 12, marginBottom: 20, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.5)' },
  input:      { paddingVertical: 14, fontSize: scale(24), textAlign: 'center', letterSpacing: 10, color: '#fff' },
  actions:    { flexDirection: 'row', gap: 12 },
  cancelBtn:  { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#112240' },
  cancelText: { color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  confirmBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.brandBlue },
  confirmText:{ color: '#fff', fontWeight: '700' },
});
