/**
 * Ecran d'un programme : liste des etapes (PLV) a visiter dans l'ordre.
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

type Props = NativeStackScreenProps<RootStackParamList, 'Programme'>;

type TriMode = 'optimise' | 'alpha' | 'a_visiter';

const TRI_MODES: { key: TriMode; label: string }[] = [
  { key: 'optimise',  label: 'Circuit' },
  { key: 'alpha',     label: 'A-Z' },
  { key: 'a_visiter', label: 'A faire' },
];

function ouvrirItineraire(lat: number, lon: number): void {
  // Pas d'origin dans l'URL : Google Maps part de la position courante.
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir la navigation."));
}

export default function ProgrammeScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [progression, setProgression] = useState<{ visitees: number; echec: number; total: number }>(
    { visitees: 0, echec: 0, total: 0 },
  );
  const [etapes, setEtapes] = useState<EtapeAvecPlv[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [triMode, setTriMode] = useState<TriMode>('optimise');

  const etapesTri = useMemo((): EtapeAvecPlv[] => {
    if (triMode === 'alpha') {
      return [...etapes].sort((a, b) => a.plv_libelle.localeCompare(b.plv_libelle, 'fr'));
    }
    if (triMode === 'a_visiter') {
      const ordre = { A_VISITER: 0, VISITEE: 1, ECHEC: 2 } as Record<string, number>;
      return [...etapes].sort((a, b) => (ordre[a.statut_visite] ?? 1) - (ordre[b.statut_visite] ?? 1));
    }
    return etapes; // 'optimise' : ordre DB conservé
  }, [etapes, triMode]);

  async function chargerDonnees() {
    const p = await getProgrammeById(programmeId);
    const e = await getEtapesDuProgramme(programmeId);
    setProgramme(p);
    setEtapes(e);
    setProgression({
      total: e.length,
      visitees: e.filter((x) => x.statut_visite === 'VISITEE').length,
      echec: e.filter((x) => x.statut_visite === 'ECHEC').length,
    });
  }

  useEffect(() => {
    (async () => {
      await chargerDonnees();
      setLoading(false);
    })();
  }, [programmeId]);

  // useCallback est requis AVANT le return anticipé ci-dessous (règle des hooks :
  // jamais après un return conditionnel).
  const renderEtape = useCallback(({ item }: { item: EtapeAvecPlv }): React.ReactElement => {
    const visite = item.statut_visite === 'VISITEE';
    const echec = item.statut_visite === 'ECHEC';
    const programmeCloture = programme?.statut === 'CLOTURE';
    const cardDisabled = programmeCloture || echec;

    const statusColor = visite ? '#198754' : echec ? '#dc3545' : '#f47920';
    const statusBg    = visite ? '#d1f5e0' : echec ? '#ffe4e6' : '#fff7ed';
    const badgeLabel  = visite ? 'Visitée' : echec ? 'Échec' : 'À visiter';
    const disabled    = echec || (programmeCloture && !visite);

    function handleCardPress() {
      if (visite) {
        if (item.op_sync_status === null) {
          // Étape visitée sur un autre appareil : l'opération n'est pas disponible hors ligne.
          Alert.alert(
            'Détail non disponible',
            "L'opération a été enregistrée sur un autre appareil et n'est pas accessible hors ligne.",
          );
          return;
        }
        navigation.navigate('EtapeDetail', { etapeId: item.id, etapeUuid: item.uuid });
      } else if (!disabled) {
        navigation.navigate('SaisieOperation', { etapeId: item.id });
      }
    }

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: statusColor }, disabled && styles.cardDisabled]}
        onPress={handleCardPress}
        activeOpacity={disabled ? 1 : 0.75}
      >
        {/* Ligne principale */}
        <View style={styles.cardMain}>
          <View style={[styles.ordreCircle, { backgroundColor: statusColor }]}>
            <Text style={styles.ordreText}>{item.ordre_prevu}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.plvLibelle}>{item.plv_libelle}</Text>
            <Text style={styles.clientName}>{item.client_raison_sociale}</Text>
          </View>
          <View style={styles.cardRight}>
            <View style={[styles.statutBadge, { backgroundColor: statusBg }]}>
              <Text style={[styles.statutText, { color: statusColor }]}>{badgeLabel}</Text>
            </View>
            {visite && item.op_sync_status !== null && (
              <View style={[
                styles.syncDot,
                item.op_sync_status === 'SYNCED' ? styles.syncDotGreen : styles.syncDotOrange,
              ]} />
            )}
          </View>
        </View>
        {/* Bouton itinéraire */}
        <TouchableOpacity
          style={styles.itineraireRow}
          onPress={(e) => { e.stopPropagation(); ouvrirItineraire(item.plv_latitude, item.plv_longitude); }}
          activeOpacity={0.65}
        >
          <Text style={styles.itineraireTxt}>Ouvrir l'itinéraire  ›</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [navigation, programme]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a7fba" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {programme && (
        <View style={styles.header}>
          {/* Cercles décoratifs arrière-plan */}
          <View style={styles.bgCircle1} pointerEvents="none" />
          <View style={styles.bgCircle2} pointerEvents="none" />

          {/* ── Zone navy : identifiant + compteurs + progression ── */}
          <View style={styles.headerNavy}>

            {/* Numéro + chips statut/type */}
            <View style={styles.headerTopRow}>
              <Text style={styles.numero}>{programme.numero_x3}</Text>
              <View style={styles.headerChips}>
                <View style={[
                  styles.typeChip,
                  programme.type_programme === 'COLLECTE' ? styles.typeChipCollecte : styles.typeChipRestit,
                ]}>
                  <Text style={styles.typeChipText}>
                    {programme.type_programme === 'COLLECTE' ? 'Collecte' : 'Restitution'}
                  </Text>
                </View>
                <View style={[
                  styles.statutChip,
                  programme.statut === 'CLOTURE' ? styles.statutCloture :
                  programme.statut === 'EN_COURS' ? styles.statutEnCours : styles.statutPlanifie,
                ]}>
                  <Text style={styles.statutChipText}>
                    {programme.statut === 'CLOTURE' ? 'Clôturé' :
                     programme.statut === 'EN_COURS' ? 'En cours' : 'Planifié'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Date */}
            <Text style={styles.dateText}>{programme.date_programme}</Text>

            {/* Compteurs */}
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statNum}>{progression.visitees}</Text>
                <Text style={styles.statLabel}>
                  {progression.visitees > 1 ? 'visitées' : 'visitée'}
                </Text>
              </View>
              <View style={[styles.statBox, progression.echec > 0 && styles.statBoxEchec]}>
                <Text style={[styles.statNum, progression.echec > 0 && styles.statNumEchec]}>
                  {progression.echec}
                </Text>
                <Text style={styles.statLabel}>échec</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, styles.statNumAFaire]}>
                  {Math.max(0, progression.total - progression.visitees - progression.echec)}
                </Text>
                <Text style={styles.statLabel}>à faire</Text>
              </View>
            </View>

            {/* Barre de progression bicolore */}
            <View style={styles.progressRow}>
              <View style={styles.progressBar}>
                <View style={[styles.progressVisitee, {
                  flex: progression.total > 0 ? progression.visitees / progression.total : 0,
                }]} />
                {progression.echec > 0 && (
                  <View style={[styles.progressEchec, {
                    flex: progression.echec / progression.total,
                  }]} />
                )}
              </View>
              <Text style={styles.progressPct}>
                {progression.total > 0
                  ? Math.round(progression.visitees / progression.total * 100)
                  : 0}%
              </Text>
            </View>

          </View>

          {/* ── Tiroir blanc : tri + actions ── */}
          <View style={styles.headerWhite}>
            <View style={styles.triBar}>
              {TRI_MODES.map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.triBtn, triMode === m.key && styles.triBtnActive]}
                  onPress={() => setTriMode(m.key)}
                >
                  <Text style={[styles.triBtnText, triMode === m.key && styles.triBtnTextActive]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.anomaliesBtn}
                onPress={() => navigation.navigate('MesAnomalies', {
                  programmeUuid: programme.uuid,
                  programmeNumero: programme.numero_x3,
                })}
              >
                <Text style={styles.anomaliesBtnText}>! Anomalies</Text>
              </TouchableOpacity>
              {programme.statut !== 'CLOTURE' ? (
                <TouchableOpacity
                  style={styles.clotureBtn}
                  onPress={() => navigation.navigate('Cloture', { programmeId: programme.id })}
                >
                  <Text style={styles.clotureBtnText}>Clôturer →</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.clotureDoneBadge}>
                  <Text style={styles.clotureDoneText}>✓ Programme clôturé</Text>
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
        ListEmptyComponent={
          <Text style={styles.empty}>Aucune étape dans ce programme.</Text>
        }
        ListFooterComponent={<View style={{ height: 80 }} />}
      />
      {programme && programme.statut !== 'CLOTURE' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('Anomalie', {
            programmeUuid: programme.uuid,
            programmeId: programme.id,
          })}
        >
          <Text style={styles.fabText}>+ Anomalie</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  // ── Header global
  header: { backgroundColor: '#0a1628', overflow: 'hidden' },
  bgCircle1: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(26,127,186,0.22)', top: -70, right: -50, zIndex: 0,
  },
  bgCircle2: {
    position: 'absolute', width: 130, height: 130, borderRadius: 65,
    backgroundColor: 'rgba(26,127,186,0.12)', top: 55, right: 95, zIndex: 0,
  },

  // ── Zone navy
  headerNavy: { padding: 16, paddingBottom: 18, zIndex: 1 },
  headerTopRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'space-between' as const, flexWrap: 'wrap' as const,
    gap: 8, marginBottom: 2,
  },
  numero: { fontSize: 20, fontWeight: '800' as const, color: '#fff', letterSpacing: -0.5 },
  headerChips: { flexDirection: 'row' as const, gap: 6 },

  typeChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  typeChipCollecte: {
    backgroundColor: 'rgba(26,127,186,0.4)', borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.55)',
  },
  typeChipRestit: {
    backgroundColor: 'rgba(25,135,84,0.4)', borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.55)',
  },
  typeChipText: { fontSize: 11, fontWeight: '700' as const, color: '#e2e8f0' },

  statutChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  statutCloture: {
    backgroundColor: 'rgba(25,135,84,0.3)', borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.45)',
  },
  statutEnCours: {
    backgroundColor: 'rgba(244,121,32,0.3)', borderWidth: 1,
    borderColor: 'rgba(251,146,60,0.5)',
  },
  statutPlanifie: {
    backgroundColor: 'rgba(148,163,184,0.2)', borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
  },
  statutChipText: { fontSize: 11, fontWeight: '700' as const, color: '#e2e8f0' },

  dateText: { fontSize: 12, color: 'rgba(255,255,255,0.48)', marginBottom: 14, marginTop: 3 },

  // ── Compteurs
  statsRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 14 },
  statBox: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10,
    paddingVertical: 10, alignItems: 'center' as const,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  statBoxEchec: {
    backgroundColor: 'rgba(220,53,69,0.22)',
    borderColor: 'rgba(220,53,69,0.38)',
  },
  statNum: { fontSize: 22, fontWeight: '800' as const, color: '#fff', lineHeight: 26 },
  statNumEchec:  { color: '#fca5a5' },
  statNumAFaire: { color: '#fdba74' },
  statLabel: {
    fontSize: 10, fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.48)', marginTop: 2,
    textTransform: 'uppercase' as const, letterSpacing: 0.4,
  },

  // ── Progression bicolore
  progressRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  progressBar: {
    flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 3, flexDirection: 'row' as const, overflow: 'hidden' as const,
  },
  progressVisitee: { height: 6, backgroundColor: '#4ade80', borderRadius: 3 },
  progressEchec:   { height: 6, backgroundColor: '#f87171' },
  progressPct: {
    fontSize: 12, fontWeight: '700' as const, color: 'rgba(255,255,255,0.62)',
    minWidth: 32, textAlign: 'right' as const,
  },

  // ── Tiroir blanc
  headerWhite: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingTop: 14, paddingHorizontal: 12, paddingBottom: 10,
  },
  triBar: {
    flexDirection: 'row' as const, backgroundColor: '#eef1f6',
    borderRadius: 10, padding: 3, gap: 3, marginBottom: 10,
  },
  triBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' as const },
  triBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#0a1628', shadowOpacity: 0.09, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  triBtnText: { fontSize: 12, fontWeight: '600' as const, color: '#94a3b8' },
  triBtnTextActive: { color: '#1a7fba' },

  // ── Actions
  actionsRow: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const },
  anomaliesBtn: {
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 9,
    backgroundColor: 'rgba(244,121,32,0.07)',
    borderWidth: 1.5, borderColor: 'rgba(244,121,32,0.28)',
  },
  anomaliesBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#c45a00' },
  clotureBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 9,
    backgroundColor: '#0a1628', alignItems: 'center' as const,
  },
  clotureBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: 13 },
  clotureDoneBadge: {
    flex: 1, paddingVertical: 9, borderRadius: 9,
    backgroundColor: 'rgba(25,135,84,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(25,135,84,0.3)',
    alignItems: 'center' as const,
  },
  clotureDoneText: { color: '#198754', fontWeight: '700' as const, fontSize: 12 },
  list: { padding: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#0a1628',
    shadowOpacity: 0.09,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: 'hidden',
  },
  cardMain: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, paddingBottom: 10,
  },
  ordreCircle: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12, flexShrink: 0,
  },
  ordreText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  plvLibelle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  clientName: { fontSize: 12, color: '#888', marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutText: { fontSize: 11, fontWeight: '700' },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncDotGreen: { backgroundColor: '#22c55e' },
  syncDotOrange: { backgroundColor: '#f97316' },
  itineraireRow: {
    borderTopWidth: 1, borderTopColor: '#f0f2f5',
    paddingVertical: 10, paddingHorizontal: 14,
    alignItems: 'flex-end',
  },
  itineraireTxt: { fontSize: 12, fontWeight: '700', color: '#1a7fba' },
  empty: { textAlign: 'center', color: '#888', padding: 32 },
  cardDisabled: { opacity: 0.45 },
  fab: {
    position: 'absolute', bottom: 20, right: 16,
    backgroundColor: '#fd7e14',
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 30,
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
