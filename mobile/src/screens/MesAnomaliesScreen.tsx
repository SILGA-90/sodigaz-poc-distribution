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

type Props = NativeStackScreenProps<RootStackParamList, 'MesAnomalies'>;

// Métadonnées d'affichage par type (valeurs DB inchangées).
const TYPE_META: Record<string, { label: string; icon: string }> = {
  'PLV ferme':         { label: 'PLV fermée',       icon: '▣' },
  'Client absent':     { label: 'Client absent',     icon: '○' },
  'Refus de paiement': { label: 'Refus paiement',    icon: '✕' },
  'Produit endommage': { label: 'Produit endommagé', icon: '⚠' },
  'Acces impossible':  { label: 'Accès impossible',  icon: '⊘' },
  'Autre':             { label: 'Autre',             icon: '?' },
};

const GRAVITE_CFG = {
  ELEVEE:  { label: 'Élevée',  color: '#dc2626', bg: '#fef2f2' },
  MOYENNE: { label: 'Moyenne', color: '#d97706', bg: '#fffbeb' },
  FAIBLE:  { label: 'Faible',  color: '#16a34a', bg: '#f0fdf4' },
} as const;

const STATUT_CFG: Record<string, { label: string; color: string; bg: string }> = {
  OUVERTE:  { label: 'Ouverte',  color: '#dc2626', bg: '#fef2f2' },
  EN_COURS: { label: 'En cours', color: '#d97706', bg: '#fffbeb' },
  RESOLUE:  { label: 'Résolue',  color: '#16a34a', bg: '#f0fdf4' },
  CLASSEE:  { label: 'Classée',  color: '#64748b', bg: '#f1f5f9' },
};

export default function MesAnomaliesScreen({ route }: Props): React.ReactElement {
  const { programmeUuid, programmeNumero } = route.params;
  const [anomalies, setAnomalies] = useState<AnomalieLocale[]>([]);
  const [loading, setLoading] = useState(true);

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
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#991b1b" />
      </View>
    );
  }

  function renderItem({ item }: { item: AnomalieLocale }): React.ReactElement {
    const synced = item.sync_status === 'SYNCED';
    const meta = TYPE_META[item.type_anomalie] ?? { label: item.type_anomalie, icon: '?' };
    const gcfg = GRAVITE_CFG[item.gravite as keyof typeof GRAVITE_CFG] ?? GRAVITE_CFG.FAIBLE;
    const scfg = STATUT_CFG[item.statut] ?? { label: item.statut, color: '#64748b', bg: '#f1f5f9' };
    const date = new Date(item.date_heure).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    return (
      <View style={[styles.card, { borderLeftColor: gcfg.color }]}>
        {/* Ligne principale : icône + type + gravité */}
        <View style={styles.cardTop}>
          <View style={[styles.iconBox, { backgroundColor: gcfg.bg }]}>
            <Text style={[styles.iconText, { color: gcfg.color }]}>{meta.icon}</Text>
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.typeLabel}>{meta.label}</Text>
            <Text style={styles.dateText}>{date}</Text>
          </View>
          <View style={[styles.gravitePill, { backgroundColor: gcfg.bg }]}>
            <Text style={[styles.graviteText, { color: gcfg.color }]}>{gcfg.label}</Text>
          </View>
        </View>

        {/* Description libre */}
        {item.description ? (
          <Text style={styles.description}>{item.description}</Text>
        ) : null}

        {/* Pied : statut + indicateur sync */}
        <View style={styles.cardFooter}>
          <View style={[styles.statutPill, { backgroundColor: scfg.bg }]}>
            <Text style={[styles.statutText, { color: scfg.color }]}>{scfg.label}</Text>
          </View>
          <View style={[styles.syncChip, synced ? styles.syncedChip : styles.pendingChip]}>
            <Text style={[styles.syncText, synced ? styles.syncedText : styles.pendingText]}>
              {synced ? '✓ Synchronisée' : '↑ En attente'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── En-tête ── */}
      <View style={styles.header}>
        <View style={styles.bgCircle1} pointerEvents="none" />
        <View style={styles.bgCircle2} pointerEvents="none" />

        <Text style={styles.headerLabel}>Anomalies</Text>
        <Text style={styles.headerNumero}>{programmeNumero}</Text>

        {anomalies.length > 0 ? (
          <View style={styles.headerStats}>
            {counts.elevee > 0 && (
              <View style={[styles.statBubble, styles.statBubbleElv]}>
                <Text style={[styles.statNum, styles.statNumElv]}>{counts.elevee}</Text>
                <Text style={[styles.statLbl, styles.statLblElv]}>
                  élevée{counts.elevee > 1 ? 's' : ''}
                </Text>
              </View>
            )}
            {counts.moyenne > 0 && (
              <View style={[styles.statBubble, styles.statBubbleMoy]}>
                <Text style={[styles.statNum, styles.statNumMoy]}>{counts.moyenne}</Text>
                <Text style={[styles.statLbl, styles.statLblMoy]}>
                  moyenne{counts.moyenne > 1 ? 's' : ''}
                </Text>
              </View>
            )}
            {counts.faible > 0 && (
              <View style={[styles.statBubble, styles.statBubbleFai]}>
                <Text style={[styles.statNum, styles.statNumFai]}>{counts.faible}</Text>
                <Text style={[styles.statLbl, styles.statLblFai]}>
                  faible{counts.faible > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.headerZero}>Aucun signalement</Text>
        )}
      </View>

      {/* ── Liste ── */}
      <FlatList
        data={anomalies}
        keyExtractor={(item) => item.uuid}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyIconText}>✓</Text>
            </View>
            <Text style={styles.emptyTitle}>Aucune anomalie</Text>
            <Text style={styles.emptyText}>
              Ce programme ne comporte aucun signalement.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── En-tête ─────────────────────────────────────────────────────────
  header: {
    backgroundColor: '#991b1b',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  bgCircle1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.06)',
    top: -60,
    right: -50,
  },
  bgCircle2: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -40,
    left: -25,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  headerNumero: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 16,
  },
  headerStats: {
    flexDirection: 'row',
    gap: 8,
  },
  statBubble: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  statBubbleElv: { backgroundColor: 'rgba(220,38,38,0.35)' },
  statBubbleMoy: { backgroundColor: 'rgba(217,119,6,0.35)'  },
  statBubbleFai: { backgroundColor: 'rgba(22,163,74,0.25)'  },
  statNum:    { fontSize: 20, fontWeight: '800', lineHeight: 24 },
  statNumElv: { color: '#fca5a5' },
  statNumMoy: { color: '#fcd34d' },
  statNumFai: { color: '#86efac' },
  statLbl:    { fontSize: 10, fontWeight: '500' },
  statLblElv: { color: 'rgba(252,165,165,0.8)' },
  statLblMoy: { color: 'rgba(252,211,77,0.8)'  },
  statLblFai: { color: 'rgba(134,239,172,0.8)' },
  headerZero: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontStyle: 'italic',
  },

  // ── Liste ─────────────────────────────────────────────────────────────
  list: { padding: 14, paddingTop: 16 },

  // ── Carte anomalie ────────────────────────────────────────────────────
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 19,
    fontWeight: '700',
  },
  cardMeta: { flex: 1 },
  typeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 2,
  },
  dateText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  gravitePill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  graviteText: {
    fontSize: 11,
    fontWeight: '700',
  },
  description: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
    gap: 8,
  },
  statutPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statutText: { fontSize: 11, fontWeight: '600' },
  syncChip: {
    marginLeft: 'auto',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  syncedChip:  { backgroundColor: '#d1fae5' },
  pendingChip: { backgroundColor: '#fef3c7' },
  syncText:    { fontSize: 11, fontWeight: '600' },
  syncedText:  { color: '#065f46' },
  pendingText: { color: '#92400e' },

  // ── État vide ─────────────────────────────────────────────────────────
  empty: {
    paddingTop: 70,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#d1fae5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  emptyIconText: { fontSize: 34, color: '#059669' },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
  },
});
