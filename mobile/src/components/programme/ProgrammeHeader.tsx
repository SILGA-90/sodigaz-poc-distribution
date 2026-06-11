import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Programme } from '../../types/models';
import { Colors } from '../../theme';
import { NAVY } from './progStyles';
import TriButtons, { TriMode } from './TriButtons';

interface Props {
  programme:          Programme;
  progression:        { visitees: number; echec: number; total: number };
  triMode:            TriMode;
  onTriModeChange:    (mode: TriMode) => void;
  onNavigateAnomalies: () => void;
  onNavigateCloture:  () => void;
}

export default function ProgrammeHeader({
  programme, progression, triMode, onTriModeChange, onNavigateAnomalies, onNavigateCloture,
}: Props): React.ReactElement {
  const aFaire = Math.max(0, progression.total - progression.visitees - progression.echec);
  const pct    = progression.total > 0 ? Math.round(progression.visitees / progression.total * 100) : 0;

  return (
    <View style={styles.header}>
      <View style={styles.bubble1} pointerEvents="none" />
      <View style={styles.bubble2} pointerEvents="none" />

      {/* Numéro + chips type/statut */}
      <View style={styles.headerTop}>
        <Text style={styles.numero}>{programme.numero_x3}</Text>
        <View style={styles.chips}>
          <View style={[styles.chip, programme.type_programme === 'COLLECTE' ? styles.chipC : styles.chipR]}>
            <Text style={styles.chipText}>{programme.type_programme === 'COLLECTE' ? 'Collecte' : 'Restitution'}</Text>
          </View>
          <View style={[styles.chip,
            programme.statut === 'CLOTURE'  ? styles.chipCloture  :
            programme.statut === 'EN_COURS' ? styles.chipEnCours  : styles.chipPlanifie]}>
            <Text style={styles.chipText}>
              {programme.statut === 'CLOTURE' ? 'Clôturé' : programme.statut === 'EN_COURS' ? 'En cours' : 'Planifié'}
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.dateText}>{programme.date_programme}</Text>

      {/* Compteurs */}
      <View style={styles.statsRow}>
        {[
          { num: progression.visitees, label: 'visitée(s)', color: '#ffffff',  bg: 'rgba(255,255,255,0.15)' },
          { num: progression.echec,    label: 'échec',      color: progression.echec > 0 ? '#fca5a5' : 'rgba(255,255,255,0.4)', bg: progression.echec > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)' },
          { num: aFaire,               label: 'à faire',    color: '#fcd34d',  bg: 'rgba(251,191,36,0.18)' },
        ].map((s, i) => (
          <View key={i} style={[styles.statBox, { backgroundColor: s.bg }]}>
            <Text style={[styles.statNum, { color: s.color }]}>{s.num}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Barre de progression */}
      <View style={styles.progRow}>
        <View style={styles.progTrack}>
          <View style={[styles.progFillVisitee, { flex: progression.total > 0 ? progression.visitees / progression.total : 0 }]} />
          {progression.echec > 0 && <View style={[styles.progFillEchec, { flex: progression.echec / progression.total }]} />}
        </View>
        <Text style={styles.progPct}>{pct}%</Text>
      </View>

      {/* Tri + Actions */}
      <View style={styles.triActions}>
        <TriButtons triMode={triMode} onTriModeChange={onTriModeChange} />
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.anomaliesBtn} onPress={onNavigateAnomalies} activeOpacity={0.8}>
            <Text style={styles.anomaliesBtnText}>⚠ Anomalies</Text>
          </TouchableOpacity>
          {programme.statut !== 'CLOTURE' ? (
            <TouchableOpacity style={styles.clotureBtn} onPress={onNavigateCloture} activeOpacity={0.82}>
              <Text style={styles.clotureBtnText}>{'Clôturer ->'}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.clotureDone}>
              <Text style={styles.clotureDoneText}>✓ Clôturé</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header:  { backgroundColor: NAVY, paddingTop: 16, overflow: 'hidden' },
  bubble1: { position: 'absolute', borderRadius: 999, width: 220, height: 220, top: -70, right: -50, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', borderRadius: 999, width: 120, height: 120, top: 55,  right: 95,  backgroundColor: 'rgba(7,155,217,0.07)' },

  headerTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 2 },
  numero:       { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  chips:        { flexDirection: 'row', gap: 6 },
  chip:         { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  chipC:        { backgroundColor: 'rgba(7,155,217,0.2)',    borderColor: 'rgba(7,155,217,0.4)' },
  chipR:        { backgroundColor: 'rgba(16,185,129,0.2)',   borderColor: 'rgba(16,185,129,0.4)' },
  chipCloture:  { backgroundColor: 'rgba(16,185,129,0.2)',   borderColor: 'rgba(16,185,129,0.4)' },
  chipEnCours:  { backgroundColor: 'rgba(238,114,2,0.2)',    borderColor: 'rgba(238,114,2,0.4)' },
  chipPlanifie: { backgroundColor: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.3)' },
  chipText:     { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  dateText:     { fontSize: 12, color: 'rgba(255,255,255,0.45)', paddingHorizontal: 16, marginBottom: 14, marginTop: 3 },

  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 14 },
  statBox:  { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  statNum:  { fontSize: 24, fontWeight: '800', lineHeight: 28 },
  statLabel:{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginTop: 2, letterSpacing: 0.5 },

  progRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 14 },
  progTrack:       { flex: 1, height: 8, borderRadius: 4, flexDirection: 'row', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.4)' },
  progFillVisitee: { height: 8, backgroundColor: '#34d399' },
  progFillEchec:   { height: 8, backgroundColor: '#f87171' },
  progPct:         { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)', minWidth: 34, textAlign: 'right' },

  triActions:       { paddingHorizontal: 12, paddingBottom: 14, gap: 10 },
  actionsRow:       { flexDirection: 'row', gap: 8 },
  anomaliesBtn:     { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, backgroundColor: 'rgba(238,114,2,0.22)', borderWidth: 1.5, borderColor: Colors.brandOrange },
  anomaliesBtnText: { fontSize: 13, fontWeight: '700', color: Colors.brandOrange },
  clotureBtn:       { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.brandBlue, borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: '#2bb8ef', borderLeftColor: '#2bb8ef', borderBottomColor: '#046a96', borderRightColor: '#046a96' },
  clotureBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  clotureDone:      { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(52,211,153,0.15)', borderWidth: 1.5, borderColor: '#34d399' },
  clotureDoneText:  { color: '#34d399', fontWeight: '700', fontSize: 13 },
});
