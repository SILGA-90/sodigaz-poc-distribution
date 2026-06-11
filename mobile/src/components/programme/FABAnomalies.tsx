import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../theme';

interface Props {
  visible: boolean;
  onPress: () => void;
}

export default function FABAnomalies({ visible, onPress }: Props): React.ReactElement | null {
  if (!visible) return null;
  return (
    <View style={styles.fab}>
      <View style={styles.outer}>
        <TouchableOpacity style={styles.inner} onPress={onPress} activeOpacity={0.82}>
          <Text style={styles.text}>+ Anomalie</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fab:   { position: 'absolute', bottom: 24, right: 20 },
  outer: {
    borderRadius: 30, backgroundColor: Colors.brandOrange,
    shadowColor: '#5c1a00', shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  inner: {
    borderRadius: 30, backgroundColor: Colors.brandOrange,
    paddingHorizontal: 22, paddingVertical: 15,
    shadowColor: '#ffcc88', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.5, shadowRadius: 6,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#ffb060', borderLeftColor: '#ffb060',
    borderBottomColor: '#b83a00', borderRightColor: '#b83a00',
  },
  text:  { color: '#fff', fontWeight: '700', fontSize: 14 },
});
