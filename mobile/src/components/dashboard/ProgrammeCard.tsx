import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ProgrammeAvecProgression } from '../../db/repositories/programmeRepository';
import { Colors } from '../../theme';
import { NEO, NEO_IN, TEXT, TEXT3 } from './dashStyles';

interface Props {
  item:    ProgrammeAvecProgression;
  onPress: () => void;
}

export default function ProgrammeCard({ item, onPress }: Props): React.ReactElement {
  const pct        = item.total_etapes > 0 ? Math.round((item.etapes_visitees / item.total_etapes) * 100) : 0;
  const isCollecte = item.type_programme === 'COLLECTE';

  const accentColor =
    item.statut === 'CLOTURE'  ? Colors.success  :
    item.statut === 'EN_COURS' ? Colors.brandBlue : TEXT3;
  const pillBg =
    item.statut === 'CLOTURE'  ? Colors.successBg :
    item.statut === 'EN_COURS' ? Colors.infoBg    : NEO_IN;
  const statutLabel =
    item.statut === 'CLOTURE'  ? 'Clôturé'  :
    item.statut === 'EN_COURS' ? 'En cours' : 'Planifié';

  return (
    <View style={styles.outer}>
      <View style={styles.shadowLight}>
        <TouchableOpacity style={styles.content} onPress={onPress} activeOpacity={0.8}>
          <View style={[styles.accent, { backgroundColor: accentColor }]} />
          <View style={styles.body}>
            <View style={styles.row1}>
              <Text style={styles.numero} numberOfLines={1}>{item.numero_x3}</Text>
              <View style={[styles.statutPill, { backgroundColor: pillBg }]}>
                <View style={[styles.statutDot, { backgroundColor: accentColor }]} />
                <Text style={[styles.statutPillText, { color: accentColor }]}>{statutLabel}</Text>
              </View>
            </View>
            <View style={styles.row2}>
              <View style={[styles.typeChip, isCollecte ? styles.typeC : styles.typeR]}>
                <Text style={[styles.typeChipText, isCollecte ? styles.typeCText : styles.typeRText]}>
                  {isCollecte ? 'Collecte' : 'Restitution'}
                </Text>
              </View>
              <Text style={styles.date}>{item.date_programme}</Text>
            </View>
            {/* Barre de progression inset */}
            <View style={styles.barWrap}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct}%` as `${number}%`, backgroundColor: accentColor }]} />
              </View>
              <Text style={[styles.pct, { color: accentColor }]}>{item.etapes_visitees}/{item.total_etapes}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginBottom: 14, borderRadius: 16, backgroundColor: NEO,
    shadowColor: '#4a6880', shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  shadowLight: {
    borderRadius: 16, backgroundColor: NEO,
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 }, shadowOpacity: 1, shadowRadius: 7,
  },
  content: {
    flexDirection: 'row', borderRadius: 16, backgroundColor: NEO, overflow: 'hidden',
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.85)', borderLeftColor: 'rgba(255,255,255,0.85)',
    borderBottomColor: 'rgba(74,104,128,0.35)', borderRightColor: 'rgba(74,104,128,0.35)',
  },
  accent: { width: 5 },
  body:   { flex: 1, padding: 14 },
  row1:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  numero: { fontSize: 14, fontWeight: '700', color: TEXT, flex: 1, marginRight: 8 },
  statutPill:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutDot:      { width: 6, height: 6, borderRadius: 3 },
  statutPillText: { fontSize: 11, fontWeight: '700' },
  row2:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  typeChip:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeC:       { backgroundColor: Colors.infoBg },
  typeR:       { backgroundColor: Colors.successBg },
  typeChipText: { fontSize: 10, fontWeight: '700' },
  typeCText:   { color: Colors.brandBlue },
  typeRText:   { color: Colors.success },
  date:        { fontSize: 12, color: TEXT3 },
  barWrap:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: {
    flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: NEO_IN,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#a8bac8', borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
  },
  barFill: { height: 6, borderRadius: 3 },
  pct:     { fontSize: 12, fontWeight: '700', minWidth: 38, textAlign: 'right' },
});
