import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, scale } from '../theme';
import { NEO, NEO_SHD } from './saisie/neoStyles';

interface Props {
  label:  string;
  signed: boolean;
}

export default function SigChip({ label, signed }: Props): React.ReactElement {
  return (
    <View style={[styles.outer, signed ? styles.outerSigned : styles.outerUnsigned]}>
      <View style={[styles.inner, signed ? styles.innerSigned : styles.innerUnsigned]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  outer:         { flex: 1, borderRadius: 12 },
  outerSigned:   { shadowColor: '#107a30', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4 },
  outerUnsigned: { shadowColor: NEO_SHD,  shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1,    shadowRadius: 5, elevation: 4 },
  inner:         {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1,
    shadowColor: '#ffffff', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 1, shadowRadius: 4,
  },
  innerSigned:   { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  innerUnsigned: { backgroundColor: NEO,              borderColor: '#b8ccd8' },
  label:         { fontSize: scale(13), fontWeight: '700' },
  labelSigned:   { color: Colors.success },
  labelUnsigned: { color: Colors.danger },
  sub:           { fontSize: scale(10), marginTop: 2 },
  subSigned:     { color: Colors.success },
  subUnsigned:   { color: Colors.danger },
});
