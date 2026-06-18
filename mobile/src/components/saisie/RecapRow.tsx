/**
 * Ligne de récapitulatif label / valeur avec couleur sémantique optionnelle.
 * Utilisé dans ClotureScreen pour le bilan de tournée.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, scale } from '../../theme';
import { SEP, TEXT, TEXT2 } from './neoStyles';

interface Props {
  label:    string;
  value:    string;
  success?: boolean;
  danger?:  boolean;
  warning?: boolean;
}

export default function RecapRow({ label, value, success, danger, warning }: Props): React.ReactElement {
  const valueColor = success ? Colors.success : danger ? Colors.danger : warning ? Colors.warning : TEXT;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: SEP },
  label: { fontSize: scale(14), color: TEXT2, flex: 1, marginRight: 8 },
  value: { fontSize: scale(15), fontWeight: '700' },
});
