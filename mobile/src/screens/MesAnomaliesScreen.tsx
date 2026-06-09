/**
 * Liste des anomalies d'un programme.
 * Design néomorphisme sombre.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getAnomaliesDuProgramme, AnomalieLocale } from '../db/repositories/anomalieRepository';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

// ── Palette néomorphisme ─────────────────────────────────────────────────────
const BASE    = '#0d1e35';
const SURFACE = '#112240';
const DEEPER  = '#07111e';
const LIFT    = 'rgba(255,255,255,0.06)';
const INSET   = '#091527';

type Props = NativeStackScreenProps<RootStackParamList, 'MesAnomalies'>;

const TYPE_META: Record<string, { label: string; icon: string }> = {
  'PLV ferme':         { label: 'PLV fermée',       icon: '▣' },
  'Client absent':     { label: 'Client absent',     icon: '○' },
  'Refus de paiement': { label: 'Refus paiement',    icon: '✕' },
  'Produit endommage': { label: 'Produit endommagé', icon: '⚠' },
  'Acces impossible':  { label: 'Accès impossible',  icon: '⊘' },
  'Autre':             { label: 'Autre',             icon: '?' },
};

const GRAVITE_CFG = {
  ELEVEE:  { label: 'Élevée',  color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)' },
  MOYENNE: { label: 'Moyenne', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)'  },
  FAIBLE:  { label: 'Faible',  color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)'  },
} as const;

const STATUT_CFG: Record<string, { label: string; color: string; bg: string }> = {
  OUVERTE:  { label: 'Ouverte',  color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  EN_COURS: { label: 'En cours', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  RESOLUE:  { label: 'Résolue',  color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  CLASSEE:  { label: 'Classée',  color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};

export default function MesAnomaliesScreen({ route }: Props): React.ReactElement {
  const { programmeUuid, programmeNumero } = route.params;
  const [anomalies, setAnomalies] = useState<AnomalieLocale[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    getAnomaliesDuProgramme(programmeUuid).then((data) => {
      setAnomalies(data);
      setLoading(false);
    });
  }, [programmeUuid]);

  const counts = useMemo(() => ({
    elevee:  anomalies.filter((a) => a.gravite === 'ELEVEE').length,
    moyenne: anomalies.filter((a) => a.gravite === 'MOYENNE').length,
    faible:  anomalies.filter((a) => a.gravite === 'FAIBLE').length,
  }), [anomalies]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#f87171" /></View>;
  }

  function renderItem({ item }: { item: AnomalieLocale }): React.ReactElement {
    const synced = item.sync_status === 'SYNCED';
    const meta   = TYPE_META[item.type_anomalie] ?? { label: item.type_anomalie, icon: '?' };
    const gcfg   = GRAVITE_CFG[item.gravite as keyof typeof GRAVITE_CFG] ?? GRAVITE_CFG.FAIBLE;
    const scfg   = STATUT_CFG[item.statut] ?? { label: item.statut, color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
    const date   = new Date(item.date_heure).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    return (
      <View style={[styles.cardOuter, { shadowColor: gcfg.color.replace(')', ',0.3)').replace('rgb(', 'rgba(') }]}>
        <View style={[styles.card, { borderLeftColor: gcfg.color }]}>
          {/* Ligne principale */}
          <View style={styles.cardTop}>
            {/* Icône type */}
            <View style={styles.iconOuter}>
              <View style={[styles.iconBox, { backgroundColor: gcfg.bg }]}>
                <Text style={[styles.iconText, { color: gcfg.color }]}>{meta.icon}</Text>
              </View>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.typeLabel}>{meta.label}</Text>
              <Text style={styles.dateText}>{date}</Text>
            </View>
            {/* Gravité pill */}
            <View style={[styles.gravitePill, { backgroundColor: gcfg.bg, borderColor: gcfg.border }]}>
              <Text style={[styles.graviteText, { color: gcfg.color }]}>{gcfg.label}</Text>
            </View>
          </View>

          {/* Description */}
          {item.description ? (
            <View style={styles.descBox}>
              <Text style={styles.description}>{item.description}</Text>
            </View>
          ) : null}

          {/* Footer statut + sync */}
          <View style={styles.cardFooter}>
            <View style={[styles.statutPill, { backgroundColor: scfg.bg }]}>
              <Text style={[styles.statutText, { color: scfg.color }]}>{scfg.label}</Text>
            </View>
            <View style={[styles.syncChip, synced ? styles.syncChipSynced : styles.syncChipPending]}>
              <Text style={[styles.syncText, synced ? styles.syncTextSynced : styles.syncTextPending]}>
                {synced ? '✓ Synchronisée' : '↑ En attente'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ══ HEADER ══ */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <Text style={styles.headerLabel}>Anomalies</Text>
          <Text style={styles.headerNumero}>{programmeNumero}</Text>

          {anomalies.length > 0 ? (
            <View style={styles.statsRow}>
              {counts.elevee > 0 && (
                <View style={[styles.statBubbleOuter, styles.statBubbleOuterElv]}>
                  <View style={[styles.statBubble, styles.statBubbleElv]}>
                    <Text style={[styles.statNum, styles.statNumElv]}>{counts.elevee}</Text>
                    <Text style={[styles.statLbl, styles.statLblElv]}>
                      élevée{counts.elevee > 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
              )}
              {counts.moyenne > 0 && (
                <View style={[styles.statBubbleOuter, styles.statBubbleOuterMoy]}>
                  <View style={[styles.statBubble, styles.statBubbleMoy]}>
                    <Text style={[styles.statNum, styles.statNumMoy]}>{counts.moyenne}</Text>
                    <Text style={[styles.statLbl, styles.statLblMoy]}>
                      moyenne{counts.moyenne > 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
              )}
              {counts.faible > 0 && (
                <View style={[styles.statBubbleOuter, styles.statBubbleOuterFai]}>
                  <View style={[styles.statBubble, styles.statBubbleFai]}>
                    <Text style={[styles.statNum, styles.statNumFai]}>{counts.faible}</Text>
                    <Text style={[styles.statLbl, styles.statLblFai]}>
                      faible{counts.faible > 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.headerZero}>Aucun signalement</Text>
          )}
        </View>
      </View>

      {/* ══ LISTE ══ */}
      <FlatList
        data={anomalies}
        keyExtractor={(item) => item.uuid}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconOuter}>
              <View style={styles.emptyIconBox}>
                <Text style={styles.emptyIconText}>✓</Text>
              </View>
            </View>
            <Text style={styles.emptyTitle}>Aucune anomalie</Text>
            <Text style={styles.emptyText}>Ce programme ne comporte aucun signalement.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BASE },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BASE },

  // Header
  header: { backgroundColor: BASE, overflow: 'hidden' },
  bubble1:{ position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(248,113,113,0.07)' },
  bubble2:{ position: 'absolute', width: 130, height: 130, borderRadius: 65,  bottom: -40, left: -25, backgroundColor: 'rgba(248,113,113,0.04)' },
  headerContent: { paddingHorizontal: 20, paddingTop: 52, paddingBottom: 24 },
  headerLabel:   { color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2 },
  headerNumero:  { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 16 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 8 },
  statBubbleOuter: { borderRadius: 12 },
  statBubbleOuterElv: { shadowColor: '#f87171', shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.5, shadowRadius: 6, elevation: 4 },
  statBubbleOuterMoy: { shadowColor: '#fbbf24', shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4 },
  statBubbleOuterFai: { shadowColor: '#34d399', shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 4 },
  statBubble: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7, alignItems: 'center', borderWidth: 1, borderTopWidth: 1, borderLeftWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT },
  statBubbleElv: { backgroundColor: 'rgba(248,113,113,0.15)', borderColor: 'rgba(248,113,113,0.3)' },
  statBubbleMoy: { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.3)'  },
  statBubbleFai: { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.3)'  },
  statNum:    { fontSize: 20, fontWeight: '800', lineHeight: 24 },
  statNumElv: { color: '#fca5a5' },
  statNumMoy: { color: '#fcd34d' },
  statNumFai: { color: '#86efac' },
  statLbl:    { fontSize: 10, fontWeight: '500' },
  statLblElv: { color: 'rgba(252,165,165,0.8)' },
  statLblMoy: { color: 'rgba(252,211,77,0.8)'  },
  statLblFai: { color: 'rgba(134,239,172,0.8)' },
  headerZero: { color: 'rgba(255,255,255,0.3)', fontSize: 13, fontStyle: 'italic' },

  list: { padding: 14, paddingTop: 16, paddingBottom: 32 },

  // Carte anomalie
  cardOuter: { marginBottom: 10, borderRadius: 14, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 },
  card: { backgroundColor: SURFACE, borderRadius: 14, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 12, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderTopColor: LIFT, borderRightColor: 'rgba(0,0,0,0.2)', borderBottomColor: 'rgba(0,0,0,0.2)', borderLeftWidth: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },

  iconOuter: { marginRight: 12, borderRadius: 12, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 5, elevation: 4 },
  iconBox:   { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  iconText:  { fontSize: 18, fontWeight: '700' },

  cardMeta:  { flex: 1 },
  typeLabel: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  dateText:  { fontSize: 12, color: 'rgba(255,255,255,0.35)' },

  gravitePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  graviteText: { fontSize: 11, fontWeight: '700' },

  descBox:  { backgroundColor: INSET, borderRadius: 8, padding: 10, marginBottom: 10, borderTopWidth: 1, borderLeftWidth: 1, borderTopColor: 'rgba(0,0,0,0.35)', borderLeftColor: 'rgba(0,0,0,0.35)' },
  description: { fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 20 },

  cardFooter: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 8, gap: 8 },
  statutPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statutText: { fontSize: 11, fontWeight: '600' },
  syncChip:   { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  syncChipSynced:  { backgroundColor: 'rgba(52,211,153,0.12)' },
  syncChipPending: { backgroundColor: 'rgba(251,191,36,0.12)' },
  syncText:        { fontSize: 11, fontWeight: '600' },
  syncTextSynced:  { color: '#34d399' },
  syncTextPending: { color: '#fbbf24' },

  // État vide
  empty: { paddingTop: 70, alignItems: 'center', paddingHorizontal: 40 },
  emptyIconOuter: { borderRadius: 38, shadowColor: '#065f46', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 5, marginBottom: 18 },
  emptyIconBox: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(52,211,153,0.1)', alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: 'rgba(52,211,153,0.3)', borderLeftColor: 'rgba(52,211,153,0.3)', borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  emptyIconText: { fontSize: 34, color: '#34d399' },
  emptyTitle:    { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.5)', marginBottom: 8 },
  emptyText:     { fontSize: 13, color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 20 },
});
