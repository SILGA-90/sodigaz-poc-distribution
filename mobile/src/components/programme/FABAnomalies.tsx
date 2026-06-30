import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme';

interface Props {
  visible: boolean;
  onPress: () => void;
}

export default function FABAnomalies({ visible, onPress }: Props): React.ReactElement | null {
  if (!visible) return null;
  return (
    <View style={styles.fab}>
      <TouchableOpacity style={styles.btn} onPress={onPress} activeOpacity={0.82}>
        <Ionicons name="warning-outline" size={26} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', bottom: 24, right: 20 },
  btn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.brandOrange,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#5c1a00', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 8,
  },
});
