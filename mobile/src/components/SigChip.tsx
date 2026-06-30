import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, scale } from '../theme';

interface Props {
  label:  string;
  signed: boolean;
}

export default function SigChip({ label, signed }: Props): React.ReactElement {
  return (
    <View style={[styles.chip, signed ? styles.chipSigned : styles.chipUnsigned]}>
      <Ionicons
        name={signed ? 'checkmark-circle' : 'close-circle-outline'}
        size={22} color={signed ? Colors.success : Colors.danger}
        style={{ marginBottom: 4 }}
      />
      <Text style={[styles.label, signed ? styles.labelSigned : styles.labelUnsigned]}>{label}</Text>
      <Text style={[styles.sub,   signed ? styles.subSigned   : styles.subUnsigned]}>
        {signed ? 'Signé' : 'Non signé'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip:         { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  chipSigned:   { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  chipUnsigned: { backgroundColor: Colors.dangerBg,  borderColor: Colors.dangerBorder },
  label:        { fontSize: scale(13), fontWeight: '700' },
  labelSigned:  { color: Colors.success },
  labelUnsigned:{ color: Colors.danger },
  sub:          { fontSize: scale(10), marginTop: 2 },
  subSigned:    { color: Colors.success },
  subUnsigned:  { color: Colors.danger },
});
