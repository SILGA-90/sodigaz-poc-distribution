import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, scale } from '../../theme';
import { NEO_IN, TEXT, TEXT2 } from './neoStyles';

export type IconColor = 'blue' | 'green' | 'red' | 'orange' | 'navy' | 'gray';

interface Props {
  icon:     React.ComponentProps<typeof Ionicons>['name'];
  color:    IconColor;
  title:    string;
  optional?: boolean;
}

const BG: Record<IconColor, string> = {
  blue:   Colors.infoBg,
  green:  Colors.successBg,
  red:    Colors.dangerBg,
  orange: Colors.warningBg,
  navy:   NEO_IN,
  gray:   NEO_IN,
};

const FG: Record<IconColor, string> = {
  blue:   Colors.brandBlue,
  green:  Colors.success,
  red:    Colors.danger,
  orange: Colors.brandOrange,
  navy:   '#3a5060',
  gray:   '#3a5060',
};

export default function SectionHeader({ icon, color, title, optional }: Props): React.ReactElement {
  return (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: BG[color] }]}>
        <Ionicons name={icon} size={16} color={FG[color]} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {optional && <Text style={styles.optional}>(optionnel)</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 22, marginBottom: 8 },
  iconBox:  { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: scale(15), fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  optional: { fontSize: scale(12), color: TEXT2, marginLeft: 2 },
});
