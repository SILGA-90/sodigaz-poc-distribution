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
    <View style={styles.headerOuter}>
    <View style={styles.header}>
      <View style={styles.bubble1} pointerEvents="none" />
      <View style={styles.bubble2} pointerEvents="none" />

      {/* Ligne 1 : numéro + chips + date (tout sur une ligne) */}
      <View style={styles.headerTop}>
        <View style={styles.headerLeft}>
          <Text style={styles.numero} numberOfLines={1}>{programme.numero_x3}</Text>
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
        <Text style={styles.dateText} numberOfLines={1}>{programme.date_programme}</Text>
      </View>

      {/* Ligne 2 : stats compactes inline + barre de progression */}
      <View style={styles.statsRow}>
        <View style={styles.statsPart}>
          <Text style={styles.statNum}>{progression.visitees}</Text>
          <Text style={styles.statLabel}> vis.</Text>
          <Text style={styles.statSep}> · </Text>
          <Text style={[styles.statNum, progression.echec > 0 && styles.statNumEchec]}>{progression.echec}</Text>
          <Text style={styles.statLabel}> échec</Text>
          <Text style={styles.statSep}> · </Text>
          <Text style={[styles.statNum, styles.statNumAFaire]}>{aFaire}</Text>
          <Text style={styles.statLabel}> à faire</Text>
        </View>
        <View style={styles.progPart}>
          <View style={styles.progTrack}>
            <View style={[styles.progFillVisitee, { flex: progression.total > 0 ? progression.visitees / progression.total : 0 }]} />
            {progression.echec > 0 && <View style={[styles.progFillEchec, { flex: progression.echec / progression.total }]} />}
          </View>
          <Text style={styles.progPct}>{pct}%</Text>
        </View>
      </View>

      {/* Ligne 3 : tri */}
      <View style={styles.triRow}>
        <TriButtons triMode={triMode} onTriModeChange={onTriModeChange} />
      </View>

      {/* Ligne 4 : actions */}
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
  headerOuter: {
    backgroundColor: NAVY,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginBottom: 16,
  },
  header:  { backgroundColor: NAVY, paddingTop: 12, overflow: 'hidden', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  bubble1: { position: 'absolute', borderRadius: 999, width: 220, height: 220, top: -70, right: -50, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', borderRadius: 999, width: 120, height: 120, top: 55,  right: 95,  backgroundColor: 'rgba(7,155,217,0.07)' },

  /* Ligne 1 */
  headerTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10, gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  numero:     { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3, flexShrink: 0 },
  chip:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  chipC:        { backgroundColor: 'rgba(7,155,217,0.2)',    borderColor: 'rgba(7,155,217,0.4)' },
  chipR:        { backgroundColor: 'rgba(16,185,129,0.2)',   borderColor: 'rgba(16,185,129,0.4)' },
  chipCloture:  { backgroundColor: 'rgba(16,185,129,0.2)',   borderColor: 'rgba(16,185,129,0.4)' },
  chipEnCours:  { backgroundColor: 'rgba(238,114,2,0.2)',    borderColor: 'rgba(238,114,2,0.4)' },
  chipPlanifie: { backgroundColor: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.3)' },
  chipText:   { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  dateText:   { fontSize: 11, color: 'rgba(255,255,255,0.4)', flexShrink: 0 },

  /* Ligne 2 : stats + progress */
  statsRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10, gap: 12 },
  statsPart: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', flexShrink: 1 },
  statNum:         { fontSize: 14, fontWeight: '800', color: '#fff' },
  statNumEchec:    { color: '#fca5a5' },
  statNumAFaire:   { color: '#fcd34d' },
  statLabel:       { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  statSep:         { fontSize: 11, color: 'rgba(255,255,255,0.22)' },
  progPart:        { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, width: 110 },
  progTrack:       { flex: 1, height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' },
  progFillVisitee: { height: 6, backgroundColor: '#34d399' },
  progFillEchec:   { height: 6, backgroundColor: '#f87171' },
  progPct:         { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.75)', width: 28, textAlign: 'right' },

  /* Ligne 3 : tri */
  triRow: { paddingHorizontal: 12, marginBottom: 8 },

  /* Ligne 4 : actions */
  actionsRow:       { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  anomaliesBtn:     { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: 'rgba(238,114,2,0.22)', borderWidth: 1.5, borderColor: Colors.brandOrange },
  anomaliesBtnText: { fontSize: 13, fontWeight: '700', color: Colors.brandOrange },
  clotureBtn:       { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.brandBlue, borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: '#2bb8ef', borderLeftColor: '#2bb8ef', borderBottomColor: '#046a96', borderRightColor: '#046a96' },
  clotureBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  clotureDone:      { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(52,211,153,0.15)', borderWidth: 1.5, borderColor: '#34d399' },
  clotureDoneText:  { color: '#34d399', fontWeight: '700', fontSize: 13 },
});
