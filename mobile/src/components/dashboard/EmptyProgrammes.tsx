import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import { NEO, NEO_SHD, TEXT, TEXT3 } from './dashStyles';

interface Props {
  syncing: boolean;
  onSync:  () => void;
}

export default function EmptyProgrammes({ syncing, onSync }: Props): React.ReactElement {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconOuter}>
        <View style={styles.iconInner}>
          <Text style={styles.iconText}>📋</Text>
        </View>
      </View>
      <Text style={styles.title}>Aucun programme en cours</Text>
      <Text style={styles.sub}>
        Tous tes programmes sont clôturés. Synchronise pour récupérer de nouveaux programmes.
      </Text>
      <View style={styles.btnOuter}>
        <TouchableOpacity style={styles.btnInner} onPress={onSync} disabled={syncing} activeOpacity={0.82}>
          <Text style={styles.btnText}>Synchroniser maintenant</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  iconOuter: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: NEO, marginBottom: 20,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.6, shadowRadius: 10, elevation: 4,
  },
  iconInner: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: NEO,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#ffffff', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.85, shadowRadius: 8,
  },
  iconText: { fontSize: scale(28) },
  title:    { fontSize: scale(16), fontWeight: '700', color: TEXT, marginBottom: 8 },
  sub:      { color: TEXT3, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btnOuter: {
    borderRadius: 14, backgroundColor: Colors.brandBlue,
    shadowColor: '#02405a', shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6,
  },
  btnInner: {
    borderRadius: 14, backgroundColor: Colors.brandBlue,
    paddingVertical: 14, paddingHorizontal: 28,
    shadowColor: '#60d4ff', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.4, shadowRadius: 6,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#2bb8ef', borderLeftColor: '#2bb8ef',
    borderBottomColor: '#046a96', borderRightColor: '#046a96',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: scale(14) },
});
