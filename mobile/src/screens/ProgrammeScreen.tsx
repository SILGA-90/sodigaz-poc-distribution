/**
 * Ecran d'un programme : liste des étapes à visiter.
 * Light thème — header navy, corps blanc.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapesDuProgramme,
  getProgrammeById,
  EtapeAvecPlv,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

const NAVY  = '#0a1628';
const BG    = '#f0f4f8';
const CARD  = '#ffffff';
const INPUT = '#f1f5f9';
const BORDER= '#e2e8f0';
const TEXT  = '#0f172a';
const TEXT2 = '#334155';
const TEXT3 = '#64748b';

type Props = NativeStackScreenProps<RootStackParamList, 'Programme'>;
type TriMode = 'optimise' | 'alpha' | 'a_visiter';

const TRI_MODES: { key: TriMode; label: string }[] = [
  { key: 'optimise',  label: 'Circuit' },
  { key: 'alpha',     label: 'A–Z' },
  { key: 'a_visiter', label: 'À faire' },
];

function ouvrirItineraire(lat: number, lon: number): void {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir la navigation."));
}

export default function ProgrammeScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme]     = useState<Programme | null>(null);
  const [progression, setProgression] = useState({ visitees: 0, echec: 0, total: 0 });
  const [etapes, setEtapes]   = useState<EtapeAvecPlv[]>([]);
  const [loading, setLoading] = useState(true);
  const [triMode, setTriMode] = useState<TriMode>('optimise');

  const etapesTri = useMemo((): EtapeAvecPlv[] => {
    if (triMode === 'alpha') return [...etapes].sort((a, b) => a.plv_libelle.localeCompare(b.plv_libelle, 'fr'));
    if (triMode === 'a_visiter') {
      const ordre = { A_VISITER: 0, VISITEE: 1, ECHEC: 2 } as Record<string, number>;
      return [...etapes].sort((a, b) => (ordre[a.statut_visite] ?? 1) - (ordre[b.statut_visite] ?? 1));
    }
    return etapes;
  }, [etapes, triMode]);

  async function chargerDonnees() {
    const p = await getProgrammeById(programmeId);
    const e = await getEtapesDuProgramme(programmeId);
    setProgramme(p);
    setEtapes(e);
    setProgression({
      total: e.length,
      visitees: e.filter((x) => x.statut_visite === 'VISITEE').length,
      echec:    e.filter((x) => x.statut_visite === 'ECHEC').length,
    });
  }

  useEffect(() => {
    (async () => { await chargerDonnees(); setLoading(false); })();
  }, [programmeId]);

  const renderEtape = useCallback(({ item }: { item: EtapeAvecPlv }): React.ReactElement => {
    const visite = item.statut_visite === 'VISITEE';
    const echec  = item.statut_visite === 'ECHEC';
    const programmeCloture = programme?.statut === 'CLOTURE';
    const disabled = echec || (programmeCloture && !visite);

    const accentColor = visite ? Colors.success : echec ? Colors.danger : Colors.brandOrange;
    const badgeBg     = visite ? Colors.successBg : echec ? Colors.dangerBg : Colors.warningBg;
    const badgeText   = visite ? Colors.success   : echec ? Colors.danger   : Colors.warning;
    const badgeLabel  = visite ? 'Visitée' : echec ? 'Échec' : 'À visiter';

    function handleCardPress() {
      if (visite) {
        if (item.op_sync_status === null) {
          Alert.alert('Détail non disponible', "L'opération a été enregistrée sur un autre appareil et n'est pas accessible hors ligne.");
          return;
        }
        navigation.navigate('EtapeDetail', { etapeId: item.id, etapeUuid: item.uuid });
      } else if (!disabled) {
        navigation.navigate('SaisieOperation', { etapeId: item.id });
      }
    }

    return (
      <View style={[styles.card, disabled && styles.cardDisabled]}>
        <TouchableOpacity style={styles.cardInner} onPress={handleCardPress} activeOpacity={disabled ? 1 : 0.75}>
          <View style={[styles.cardAccent, { backgroundColor: accentColor }]} />
          <View style={styles.cardBody}>
            <View style={styles.cardMain}>
              {/* Cercle d'ordre coloré */}
              <View style={[styles.ordreCircle, { backgroundColor: accentColor }]}>
                <Text style={styles.ordreText}>{item.ordre_prevu}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.plvLibelle} numberOfLines={1}>{item.plv_libelle}</Text>
                <Text style={styles.clientName} numberOfLines={1}>{item.client_raison_sociale}</Text>
              </View>
              <View style={styles.cardRight}>
                <View style={[styles.statutBadge, { backgroundColor: badgeBg }]}>
                  <View style={[styles.statutDot, { backgroundColor: accentColor }]} />
                  <Text style={[styles.statutText, { color: badgeText }]}>{badgeLabel}</Text>
                </View>
                {visite && item.op_sync_status !== null && (
                  <View style={[styles.syncIndicator,
                    item.op_sync_status === 'SYNCED' ? styles.syncGreen : styles.syncOrange]} />
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.itineraireRow}
              onPress={(e) => { e.stopPropagation(); ouvrirItineraire(item.plv_latitude, item.plv_longitude); }}
              activeOpacity={0.65}
            >
              <Text style={styles.itineraireTxt}>Ouvrir l'itinéraire  ›</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [navigation, programme]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;
  }

  const aFaire = Math.max(0, progression.total - progression.visitees - progression.echec);
  const pct    = progression.total > 0 ? Math.round(progression.visitees / progression.total * 100) : 0;

  return (
    <View style={styles.root}>
      {programme && (
        <View style={styles.header}>
          <View style={styles.bubble1} pointerEvents="none" />
          <View style={styles.bubble2} pointerEvents="none" />

          <View style={styles.headerTop}>
            <Text style={styles.numero}>{programme.numero_x3}</Text>
            <View style={styles.chips}>
              <View style={[styles.chip, programme.type_programme === 'COLLECTE' ? styles.chipC : styles.chipR]}>
                <Text style={styles.chipText}>{programme.type_programme === 'COLLECTE' ? 'Collecte' : 'Restitution'}</Text>
              </View>
              <View style={[styles.chip,
                programme.statut === 'CLOTURE'  ? styles.chipCloture :
                programme.statut === 'EN_COURS' ? styles.chipEnCours : styles.chipPlanifie]}>
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
              { num: progression.visitees, label: 'visitée(s)', color: '#ffffff', bg: 'rgba(255,255,255,0.15)' },
              { num: progression.echec,    label: 'échec',      color: progression.echec > 0 ? '#fca5a5' : 'rgba(255,255,255,0.4)', bg: progression.echec > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)' },
              { num: aFaire,               label: 'à faire',    color: '#fcd34d', bg: 'rgba(251,191,36,0.18)' },
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
            <View style={styles.triTrack}>
              {TRI_MODES.map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.triBtn, triMode === m.key && styles.triBtnActive]}
                  onPress={() => setTriMode(m.key)}
                >
                  <Text style={[styles.triBtnText, triMode === m.key && styles.triBtnTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.anomaliesBtn}
                onPress={() => navigation.navigate('MesAnomalies', { programmeUuid: programme.uuid, programmeNumero: programme.numero_x3 })}
                activeOpacity={0.8}
              >
                <Text style={styles.anomaliesBtnText}>⚠ Anomalies</Text>
              </TouchableOpacity>

              {programme.statut !== 'CLOTURE' ? (
                <TouchableOpacity
                  style={styles.clotureBtn}
                  onPress={() => navigation.navigate('Cloture', { programmeId: programme.id })}
                  activeOpacity={0.82}
                >
                  <Text style={styles.clotureBtnText}>Clôturer →</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.clotureDone}>
                  <Text style={styles.clotureDoneText}>✓ Clôturé</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      <FlatList
        data={etapesTri}
        keyExtractor={(item) => item.uuid}
        renderItem={renderEtape}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.emptyWrap}><Text style={styles.emptyText}>Aucune étape.</Text></View>}
        ListFooterComponent={<View style={{ height: 100 }} />}
      />

      {programme && programme.statut !== 'CLOTURE' && (
        <View style={styles.fab}>
          <TouchableOpacity
            style={styles.fabBtn}
            onPress={() => navigation.navigate('Anomalie', { programmeUuid: programme.uuid, programmeId: programme.id })}
            activeOpacity={0.82}
          >
            <Text style={styles.fabText}>+ Anomalie</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG },

  // ── Header navy ───────────────────────────────────────────────────────────
  header: { backgroundColor: NAVY, paddingTop: 16, overflow: 'hidden' },
  bubble1: { position: 'absolute', borderRadius: 999, width: 220, height: 220, top: -70, right: -50, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', borderRadius: 999, width: 120, height: 120, top: 55,  right: 95,  backgroundColor: 'rgba(7,155,217,0.07)' },

  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 2 },
  numero:   { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  chips:    { flexDirection: 'row', gap: 6 },
  chip:     { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  chipC:        { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  chipR:        { backgroundColor: 'rgba(16,185,129,0.2)', borderColor: 'rgba(16,185,129,0.4)' },
  chipCloture:  { backgroundColor: 'rgba(16,185,129,0.2)', borderColor: 'rgba(16,185,129,0.4)' },
  chipEnCours:  { backgroundColor: 'rgba(238,114,2,0.2)',  borderColor: 'rgba(238,114,2,0.4)' },
  chipPlanifie: { backgroundColor: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.3)' },
  chipText: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  dateText: { fontSize: 12, color: 'rgba(255,255,255,0.45)', paddingHorizontal: 16, marginBottom: 14, marginTop: 3 },

  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 14 },
  statBox:  { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  statNum:  { fontSize: 24, fontWeight: '800', lineHeight: 28 },
  statLabel:{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginTop: 2, letterSpacing: 0.5 },

  progRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 14 },
  progTrack:       { flex: 1, height: 7, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4, flexDirection: 'row', overflow: 'hidden' },
  progFillVisitee: { height: 7, backgroundColor: '#34d399', borderRadius: 4 },
  progFillEchec:   { height: 7, backgroundColor: '#f87171' },
  progPct:         { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.7)', minWidth: 34, textAlign: 'right' },

  triActions: { paddingHorizontal: 12, paddingBottom: 14, gap: 10 },
  triTrack:   { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 3, gap: 3 },
  triBtn:     { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  triBtnActive: { backgroundColor: '#ffffff' },
  triBtnText:   { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  triBtnTextActive: { color: Colors.brandBlue, fontWeight: '700' },

  actionsRow:    { flexDirection: 'row', gap: 8 },
  anomaliesBtn:  { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, backgroundColor: 'rgba(238,114,2,0.15)', borderWidth: 1.5, borderColor: 'rgba(238,114,2,0.4)' },
  anomaliesBtnText: { fontSize: 13, fontWeight: '700', color: Colors.brandOrange },
  clotureBtn:    { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.brandBlue },
  clotureBtnText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
  clotureDone:   { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(52,211,153,0.15)', borderWidth: 1.5, borderColor: 'rgba(52,211,153,0.4)' },
  clotureDoneText: { color: '#34d399', fontWeight: '700', fontSize: 13 },

  // ── Cartes étapes ─────────────────────────────────────────────────────────
  list: { padding: 12 },
  card: { borderRadius: 14, marginBottom: 10, backgroundColor: CARD, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  cardDisabled: { opacity: 0.45 },
  cardInner:    { flexDirection: 'row', borderRadius: 14, overflow: 'hidden' },
  cardAccent:   { width: 4 },
  cardBody:     { flex: 1 },
  cardMain:     { flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 },

  ordreCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  ordreText:   { color: '#fff', fontWeight: '800', fontSize: 15 },

  cardInfo:   { flex: 1, marginRight: 8 },
  plvLibelle: { fontSize: 14, fontWeight: '700', color: TEXT },
  clientName: { fontSize: 12, color: TEXT3, marginTop: 2 },

  cardRight:   { alignItems: 'flex-end', gap: 6 },
  statutBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutDot:   { width: 6, height: 6, borderRadius: 3 },
  statutText:  { fontSize: 11, fontWeight: '700' },
  syncIndicator: { width: 8, height: 8, borderRadius: 4 },
  syncGreen:  { backgroundColor: '#22c55e' },
  syncOrange: { backgroundColor: '#f97316' },

  itineraireRow: { borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: INPUT, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'flex-end' },
  itineraireTxt: { fontSize: 12, fontWeight: '700', color: Colors.brandBlue },

  emptyWrap: { padding: 40, alignItems: 'center' },
  emptyText: { color: TEXT3, textAlign: 'center', fontSize: 14 },

  // FAB
  fab:    { position: 'absolute', bottom: 24, right: 20 },
  fabBtn: { backgroundColor: Colors.brandOrange, paddingHorizontal: 22, paddingVertical: 15, borderRadius: 30, shadowColor: Colors.brandOrange, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  fabText:{ color: '#fff', fontWeight: '700', fontSize: 14 },
});
