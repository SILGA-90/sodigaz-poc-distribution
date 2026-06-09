/**
 * Ecran de cloture d'un programme : recapitulatif + confirmation.
 * Design néomorphisme sombre.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getProgrammeById,
  getRecapProgramme,
  getOperationsRecapProgramme,
  cloturerProgrammeLocal,
  RecapProgramme,
  OperationRecap,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

// ── Palette néomorphisme ─────────────────────────────────────────────────────
const BASE    = '#0d1e35';
const SURFACE = '#112240';
const DEEPER  = '#07111e';
const LIFT    = 'rgba(255,255,255,0.06)';
const INSET   = '#091527';

type Props = NativeStackScreenProps<RootStackParamList, 'Cloture'>;

export default function ClotureScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [recap, setRecap]         = useState<RecapProgramme | null>(null);
  const [operations, setOperations] = useState<OperationRecap[]>([]);
  const [loading, setLoading]     = useState(true);
  const [closing, setClosing]     = useState(false);
  const [clotureReussie, setClotureReussie] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      if (p) {
        const [r, ops] = await Promise.all([
          getRecapProgramme(programmeId, p.uuid),
          getOperationsRecapProgramme(programmeId),
        ]);
        setProgramme(p);
        setRecap(r);
        setOperations(ops);
      }
      setLoading(false);
    })();
  }, [programmeId]);

  function confirmerCloture(): void {
    if (!programme || !recap) return;
    const reste = recap.total_etapes - recap.etapes_visitees;
    const message = reste > 0
      ? `Attention : ${reste} étape(s) non visitée(s). Clôturer quand même ?`
      : 'Toutes les étapes sont visitées. Confirmer la clôture ?';
    Alert.alert('Clôturer le programme', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Clôturer', style: 'destructive', onPress: faireCloture },
    ]);
  }

  async function faireCloture(): Promise<void> {
    if (!programme) return;
    setClosing(true);
    try {
      await cloturerProgrammeLocal(programme.uuid);
      setClotureReussie(true);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;
  }

  if (!programme || !recap) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Programme introuvable.</Text>
      </View>
    );
  }

  // ── État clôture réussie ────────────────────────────────────────────────────
  if (clotureReussie) {
    const pct = recap.total_etapes > 0
      ? Math.round((recap.etapes_visitees / recap.total_etapes) * 100) : 0;
    return (
      <View style={styles.successRoot}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />

        {/* Grande icône ✓ néomorphe */}
        <View style={styles.successCheckOuter}>
          <View style={styles.successCheck}>
            <Text style={styles.successCheckText}>✓</Text>
          </View>
        </View>
        <Text style={styles.successTitle}>Tournée terminée</Text>
        <Text style={styles.successSub}>{programme.numero_x3} · {programme.date_programme}</Text>

        {/* Bilan */}
        <View style={styles.cardOuter}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Bilan de la tournée</Text>
            <RecapRow label="Étapes visitées"
              value={`${recap.etapes_visitees} / ${recap.total_etapes} (${pct} %)`} />
            {recap.etapes_echec > 0 && (
              <RecapRow label="Étapes en échec" value={String(recap.etapes_echec)} danger />
            )}
            <RecapRow label="Opérations réalisées" value={String(recap.nb_operations)} />
            <RecapRow label="Montant encaissé"
              value={`${recap.montant_encaisse.toLocaleString('fr-FR')} FCFA`} success />
            {recap.nb_anomalies > 0 && (
              <RecapRow label="Anomalies signalées" value={String(recap.nb_anomalies)} warning />
            )}
          </View>
        </View>

        {/* Avertissement sync */}
        <View style={styles.syncNoticeOuter}>
          <View style={styles.syncNotice}>
            <Text style={styles.syncNoticeIcon}>↑</Text>
            <Text style={styles.syncNoticeText}>
              Synchronisez dès que possible pour remonter vos données au superviseur.
            </Text>
          </View>
        </View>

        {/* Bouton retour tableau de bord */}
        <View style={styles.backBtnOuter}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('Dashboard')} activeOpacity={0.85}>
            <View style={styles.backBtnSheen} pointerEvents="none" />
            <Text style={styles.backBtnText}>Retour au tableau de bord</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Vue principale ──────────────────────────────────────────────────────────
  const dejaCloture = programme.statut === 'CLOTURE';
  const isCollecte  = programme.type_programme === 'COLLECTE';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* ══ HEADER ══ */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <View style={[styles.typeChip, isCollecte ? styles.typeChipC : styles.typeChipR]}>
            <Text style={styles.typeChipText}>{isCollecte ? 'Collecte' : 'Restitution'}</Text>
          </View>
          <Text style={styles.numero}>{programme.numero_x3}</Text>
          <Text style={styles.meta}>{programme.date_programme}</Text>
        </View>
      </View>

      {/* ══ RÉCAPITULATIF ══ */}
      <SectionHeader icon="≡" color="blue" title="Récapitulatif de la tournée" />
      <View style={styles.cardOuter}>
        <View style={styles.card}>
          <RecapRow label="Étapes visitées" value={`${recap.etapes_visitees} / ${recap.total_etapes}`} />
          {recap.etapes_echec > 0 && (
            <RecapRow label="Étapes en échec" value={String(recap.etapes_echec)} danger />
          )}
          <RecapRow label="Opérations réalisées" value={String(recap.nb_operations)} />
          <RecapRow label="Montant encaissé"
            value={`${recap.montant_encaisse.toLocaleString('fr-FR')} FCFA`} success />
          {recap.nb_anomalies > 0 && (
            <RecapRow label="Anomalies signalées" value={String(recap.nb_anomalies)} warning />
          )}
        </View>
      </View>

      {/* ══ DÉTAIL DES OPÉRATIONS ══ */}
      {operations.length > 0 && (
        <>
          <SectionHeader icon="↓" color="blue" title="Détail des opérations" />
          <View style={styles.cardOuter}>
            <View style={styles.card}>
              {operations.map((op, i) => (
                <View key={i} style={[styles.opRow, i > 0 && styles.opRowSep]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.opPlv}>{op.plv_libelle}</Text>
                    <Text style={styles.opType}>
                      {op.type_operation === 'COLLECTE' ? 'Collecte' : 'Restitution'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.opMontant}>
                      {op.montant_total.toLocaleString('fr-FR')} FCFA
                    </Text>
                    <Text style={[styles.opEncaisse, { color: op.est_encaissee ? '#34d399' : '#f87171' }]}>
                      {op.est_encaissee ? 'Encaissé' : 'Non encaissé'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </>
      )}

      {/* ══ ACTION ══ */}
      {dejaCloture ? (
        <View style={styles.clotureBadgeOuter}>
          <View style={styles.clotureBadge}>
            <Text style={styles.clotureBadgeText}>✓ Programme déjà clôturé</Text>
          </View>
        </View>
      ) : (
        <View style={styles.clotureBtnOuter}>
          <TouchableOpacity
            style={[styles.clotureBtn, closing && styles.clotureBtnDisabled]}
            onPress={confirmerCloture}
            disabled={closing}
            activeOpacity={0.85}
          >
            <View style={styles.clotureBtnSheen} pointerEvents="none" />
            {closing
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.clotureBtnText}>Clôturer le programme</Text>
                  <Text style={styles.clotureBtnSub}>Action irréversible</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      )}

    </ScrollView>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

type IconColor = 'blue' | 'green' | 'orange' | 'navy' | 'gray';
function SectionHeader({ icon, color, title }: { icon: string; color: IconColor; title: string }) {
  const bg: Record<IconColor, string> = { blue: 'rgba(7,155,217,0.15)', green: 'rgba(52,211,153,0.15)', orange: 'rgba(238,114,2,0.15)', navy: 'rgba(255,255,255,0.08)', gray: 'rgba(148,163,184,0.12)' };
  const fg: Record<IconColor, string> = { blue: Colors.brandBlue, green: '#34d399', orange: Colors.brandOrange, navy: 'rgba(255,255,255,0.7)', gray: '#94a3b8' };
  return (
    <View style={sh.row}>
      <View style={sh.iconOuter}>
        <View style={[sh.iconBox, { backgroundColor: bg[color] }]}>
          <Text style={[sh.iconText, { color: fg[color] }]}>{icon}</Text>
        </View>
      </View>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}
const sh = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 22, marginBottom: 8 },
  iconOuter:{ borderRadius: 10, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 5, elevation: 4 },
  iconBox:  { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  iconText: { fontSize: 14, fontWeight: '800' },
  title:    { fontSize: 14, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: -0.2 },
});

function RecapRow({ label, value, success, danger, warning }: { label: string; value: string; success?: boolean; danger?: boolean; warning?: boolean }) {
  const vColor = success ? '#34d399' : danger ? '#f87171' : warning ? '#fbbf24' : '#fff';
  return (
    <View style={rr.row}>
      <Text style={rr.label}>{label}</Text>
      <Text style={[rr.value, { color: vColor }]}>{value}</Text>
    </View>
  );
}
const rr = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  label: { fontSize: 14, color: 'rgba(255,255,255,0.45)', flex: 1, marginRight: 8 },
  value: { fontSize: 15, fontWeight: '700' },
});

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BASE },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BASE, padding: 32 },
  errorText: { color: 'rgba(255,255,255,0.4)', fontSize: 15 },

  // Header
  header: { backgroundColor: BASE, overflow: 'hidden' },
  bubble1:{ position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(7,155,217,0.08)' },
  bubble2:{ position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 30, right: 110,  backgroundColor: 'rgba(7,155,217,0.05)' },
  headerContent: { padding: 16, paddingBottom: 22 },
  typeChip: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginBottom: 8, borderWidth: 1 },
  typeChipC: { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  typeChipR: { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  numero: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  meta:   { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  // Cards
  cardOuter: { marginHorizontal: 12, marginBottom: 4, borderRadius: 16, shadowColor: DEEPER, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.85, shadowRadius: 12, elevation: 6 },
  card: { backgroundColor: SURFACE, borderRadius: 16, padding: 14, borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.7)', marginBottom: 8 },

  // Opérations
  opRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 11 },
  opRowSep: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  opPlv:    { fontSize: 13, fontWeight: '700', color: '#fff' },
  opType:   { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  opMontant:{ fontSize: 14, fontWeight: '700', color: '#fff' },
  opEncaisse:{ fontSize: 11, marginTop: 2 },

  // Badges
  clotureBadgeOuter: { marginHorizontal: 12, marginTop: 20, borderRadius: 12, shadowColor: '#065f46', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 4 },
  clotureBadge: { backgroundColor: 'rgba(52,211,153,0.1)', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)' },
  clotureBadgeText: { color: '#34d399', fontWeight: '700', fontSize: 14 },

  // Bouton clôturer
  clotureBtnOuter: { marginHorizontal: 12, marginTop: 22, marginBottom: 8, borderRadius: 14, shadowColor: '#065f46', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.55, shadowRadius: 14, elevation: 10 },
  clotureBtn: { backgroundColor: '#059669', borderRadius: 14, paddingVertical: 17, alignItems: 'center', overflow: 'hidden' },
  clotureBtnSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.1)', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  clotureBtnDisabled: { opacity: 0.5 },
  clotureBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  clotureBtnSub:  { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },

  // ── État succès ──
  successRoot: { flex: 1, backgroundColor: BASE, padding: 24, alignItems: 'center', justifyContent: 'center' },
  successCheckOuter: { borderRadius: 44, shadowColor: '#065f46', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.7, shadowRadius: 16, elevation: 10, marginBottom: 20 },
  successCheck: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(52,211,153,0.15)', borderWidth: 2, borderColor: 'rgba(52,211,153,0.4)', alignItems: 'center', justifyContent: 'center' },
  successCheckText: { fontSize: 44, color: '#34d399' },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginBottom: 4 },
  successSub:   { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 28 },

  syncNoticeOuter: { width: '100%', marginBottom: 14, borderRadius: 12, shadowColor: DEEPER, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.8, shadowRadius: 8, elevation: 4 },
  syncNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(251,191,36,0.1)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)' },
  syncNoticeIcon: { fontSize: 18, color: '#fbbf24' },
  syncNoticeText: { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 18 },

  backBtnOuter: { width: '100%', borderRadius: 14, shadowColor: Colors.brandBlue, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 14, elevation: 10 },
  backBtn: { backgroundColor: Colors.brandBlue, borderRadius: 14, paddingVertical: 16, alignItems: 'center', overflow: 'hidden' },
  backBtnSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.12)', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  backBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
