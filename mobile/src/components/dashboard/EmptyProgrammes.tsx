import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, scale } from '../../theme';
import { TEXT, TEXT3 } from './dashStyles';

interface Props {
  syncing: boolean;
  onSync:  () => void;
}

export default function EmptyProgrammes({ syncing, onSync }: Props): React.ReactElement {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name="clipboard-outline" size={32} color={Colors.brandBlue} />
      </View>
      <Text style={styles.title}>Aucun programme en cours</Text>
      <Text style={styles.sub}>
        Tous tes programmes sont clôturés. Synchronise pour récupérer de nouveaux programmes.
      </Text>
      <TouchableOpacity
        style={[styles.btn, syncing && { opacity: 0.55 }]}
        onPress={onSync}
        disabled={syncing}
        activeOpacity={0.82}
      >
        <Text style={styles.btnText}>Synchroniser maintenant</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:    { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
  },
  title:   { fontSize: scale(16), fontWeight: '700', color: TEXT, marginBottom: 8 },
  sub:     { color: TEXT3, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn: {
    borderRadius: 12,
    backgroundColor: Colors.brandBlue,
    paddingVertical: 14, paddingHorizontal: 28,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: scale(14) },
});
