import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';

interface Props {
  visible: boolean;
  onPress: () => void;
}

export default function FABAnomalies({ visible, onPress }: Props): React.ReactElement | null {
  if (!visible) return null;
  return (
    <View style={styles.fab}>
      <TouchableOpacity style={styles.btn} onPress={onPress} activeOpacity={0.82}>
        <Text style={styles.text}>+ Anomalie</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', bottom: 24, right: 20 },
  btn: {
    borderRadius: 30,
    backgroundColor: Colors.brandOrange,
    paddingHorizontal: 22, paddingVertical: 15,
    shadowColor: '#5c1a00', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 8,
  },
  text: { color: '#fff', fontWeight: '700', fontSize: scale(14) },
});
