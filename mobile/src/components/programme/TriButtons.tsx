import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';

export type TriMode = 'optimise' | 'alpha' | 'a_visiter';

export const TRI_MODES: { key: TriMode; label: string }[] = [
  { key: 'optimise',  label: 'Circuit' },
  { key: 'alpha',     label: 'A–Z' },
  { key: 'a_visiter', label: 'À faire' },
];

interface Props {
  triMode:         TriMode;
  onTriModeChange: (mode: TriMode) => void;
}

export default function TriButtons({ triMode, onTriModeChange }: Props): React.ReactElement {
  return (
    <View style={styles.track}>
      {TRI_MODES.map((m) => (
        <TouchableOpacity
          key={m.key}
          style={[styles.btn, triMode === m.key && styles.btnActive]}
          onPress={() => onTriModeChange(m.key)}
        >
          <Text style={[styles.btnText, triMode === m.key && styles.btnTextActive]}>{m.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row', borderRadius: 12, padding: 4, gap: 3,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  btn:         { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  btnActive:   { backgroundColor: '#ffffff', shadowColor: '#040d1a', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.5, shadowRadius: 3, elevation: 2 },
  btnText:     { fontSize: scale(12), fontWeight: '600', color: '#ffffff' },
  btnTextActive: { color: Colors.brandBlue, fontWeight: '700' },
});
