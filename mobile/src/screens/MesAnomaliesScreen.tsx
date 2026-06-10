/**
 * Liste des anomalies d'un programme — néomorphisme clair.
 * Header navy (bulles danger), cartes raised avec bande accent gravité, inset desc.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getAnomaliesDuProgramme, AnomalieLocale } from '../db/repositories/anomalieRepository';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

/* ── Palette néo claire ─────────────────────────────────────────────── */
const NEO     = '#e8edf2';
const NEO_SHD = '#4a6880';
const NEO_IN  = '#d4dde6';
const NAVY    = '#0a1628';
const TEXT    = '#1a2a3a';
const TEXT2   = '#3a5060';
const TEXT3   = '#3a5060';
const SEP     = '#c8d4de';

type Props = NativeStackScreenProps<RootStackParamList, 'MesAnomalies'>;

const TYPE_META: Record<string, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  'PLV ferme':         { label: 'PLV fermée',       icon: 'lock-closed-outline' },
  'Client absent':     { label: 'Client absent',     icon: 'person-outline' },
  'Refus de paiement': { label: 'Refus paiement',    icon: 'card-outline' },
  'Produit endommage': { label: 'Produit endommagé', icon: 'warning-outline' },
  'Acces impossible':  { label: 'Accès impossible',  icon: 'ban-outline' },
  'Autre':             { label: 'Autre',             icon: 'help-circle-outline' },
};

const GRAVITE_CFG = {
  ELEVEE:  { label: 'Élevée',  color: Colors.danger,  bg: Colors.dangerBg,  border: Colors.dangerBorder  },
  MOYENNE: { label: 'Moyenne', color: Colors.warning,  bg: Colors.warningBg, border: Colors.warningBorder },
  FAIBLE:  { label: 'Faible',  color: Colors.success,  bg: Colors.successBg, border: Colors.successBorder },
} as const;

const STATUT_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  OUVERTE:  { label: 'Ouverte',  color: Colors.danger,      bg: Colors.dangerBg,  border: Colors.dangerBorder  },
  EN_COURS: { label: 'En cours', color: Colors.warning,      bg: Colors.warningBg, border: Colors.warningBorder },
  RESOLUE:  { label: 'Résolue',  color: Colors.success,      bg: Colors.successBg, border: Colors.successBorder },
  CLASSEE:  { label: 'Classée',  color: Colors.textMuted,    bg: NEO_IN,           border: SEP                  },
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
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.danger} /></View>;
  }

  function renderItem({ item }: { item: AnomalieLocale }): React.ReactElement {
    const synced = item.sync_status === 'SYNCED';
    const meta   = TYPE_META[item.type_anomalie] ?? { label: item.type_anomalie, icon: 'help-circle-outline' as const };
    const gcfg   = GRAVITE_CFG[item.gravite as keyof typeof GRAVITE_CFG] ?? GRAVITE_CFG.FAIBLE;
    const scfg   = STATUT_CFG[item.statut] ?? { label: item.statut, color: TEXT3, bg: NEO_IN, border: SEP };
    const date   = new Date(item.date_heure).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });

    return (
      <View style={styles.cardOuter}>
        <View style={[styles.cardInner, { borderLeftColor: gcfg.color }]}>
          {/* Ligne principale */}
          <View style={styles.cardTop}>
            {/* Icône type */}
            <View style={[styles.iconBox, { backgroundColor: gcfg.bg, borderColor: gcfg.border }]}>
              <Ionicons name={meta.icon} size={20} color={gcfg.color} />
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

          {/* Description inset */}
          {item.description ? (
            <View style={styles.descBox}>
              <Text style={styles.description}>{item.description}</Text>
            </View>
          ) : null}

          {/* Footer statut + sync */}
          <View style={styles.cardFooter}>
            <View style={[styles.statutPill, { backgroundColor: scfg.bg, borderColor: scfg.border }]}>
              <Text style={[styles.statutText, { color: scfg.color }]}>{scfg.label}</Text>
            </View>
            <View style={[styles.syncChip, synced ? styles.syncChipSynced : styles.syncChipPending]}>
              <Ionicons
                name={synced ? 'checkmark-circle-outline' : 'cloud-upload-outline'}
                size={12}
                color={synced ? Colors.success : Colors.warning}
                style={{ marginRight: 3 }}
              />
              <Text style={[styles.syncText, { color: synced ? Colors.success : Colors.warning }]}>
                {synced ? 'Synchronisée' : 'En attente'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>

      {/* ── Header navy (bulles danger) ── */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <Text style={styles.headerLabel}>Anomalies</Text>
          <Text style={styles.headerNumero}>{programmeNumero}</Text>

          {anomalies.length > 0 ? (
            <View style={styles.statsRow}>
              {counts.elevee > 0 && (
                <View style={styles.statChip}>
                  <View style={[styles.statDot, { backgroundColor: Colors.danger }]} />
                  <Text style={[styles.statNum, { color: Colors.danger }]}>{counts.elevee}</Text>
                  <Text style={[styles.statLbl, { color: Colors.danger }]}>élevée{counts.elevee > 1 ? 's' : ''}</Text>
                </View>
              )}
              {counts.moyenne > 0 && (
                <View style={styles.statChip}>
                  <View style={[styles.statDot, { backgroundColor: Colors.warning }]} />
                  <Text style={[styles.statNum, { color: Colors.warning }]}>{counts.moyenne}</Text>
                  <Text style={[styles.statLbl, { color: Colors.warning }]}>moyenne{counts.moyenne > 1 ? 's' : ''}</Text>
                </View>
              )}
              {counts.faible > 0 && (
                <View style={styles.statChip}>
                  <View style={[styles.statDot, { backgroundColor: Colors.success }]} />
                  <Text style={[styles.statNum, { color: Colors.success }]}>{counts.faible}</Text>
                  <Text style={[styles.statLbl, { color: Colors.success }]}>faible{counts.faible > 1 ? 's' : ''}</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.headerZero}>Aucun signalement</Text>
          )}
        </View>
      </View>

      {/* ── Liste ── */}
      <FlatList
        data={anomalies}
        keyExtractor={(item) => item.uuid}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyOuter}>
              <View style={styles.emptyInner}>
                <Ionicons name="checkmark-circle" size={34} color={Colors.success} />
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

/* ── Styles ──────────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: NEO },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO },

  /* Header navy */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(220,38,38,0.1)' },
  bubble2: { position: 'absolute', width: 130, height: 130, borderRadius: 65, bottom: -40, left: -25, backgroundColor: 'rgba(220,38,38,0.07)' },
  headerContent: { paddingHorizontal: 20, paddingTop: 52, paddingBottom: 24 },
  headerLabel:   { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2 },
  headerNumero:  { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 16 },

  /* Stats dans le header — chips glass */
  statsRow: { flexDirection: 'row', gap: 8 },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  statNum: { fontSize: 16, fontWeight: '800', lineHeight: 20 },
  statLbl: { fontSize: 10, fontWeight: '500' },
  headerZero: { color: 'rgba(255,255,255,0.35)', fontSize: 13, fontStyle: 'italic' },

  list: { padding: 14, paddingTop: 16, paddingBottom: 32 },

  /* Carte anomalie raised + bande accent gravité */
  cardOuter: {
    marginBottom: 10,
    borderRadius: 14, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  cardInner: {
    borderRadius: 14, backgroundColor: NEO, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 12,
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 }, shadowOpacity: 1, shadowRadius: 7,
    borderLeftWidth: 4,
    borderTopWidth: 1.5, borderTopColor: '#ffffff',
    borderBottomWidth: 1.5, borderBottomColor: '#8aa8c0',
    borderRightWidth: 1.5, borderRightColor: '#8aa8c0',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },

  iconBox: {
    width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1,
  },
  cardMeta:  { flex: 1 },
  typeLabel: { fontSize: 14, fontWeight: '700', color: TEXT, marginBottom: 2 },
  dateText:  { fontSize: 12, color: TEXT3 },

  gravitePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  graviteText: { fontSize: 11, fontWeight: '700' },

  /* Description inset */
  descBox: {
    backgroundColor: NEO_IN, borderRadius: 8, padding: 10, marginBottom: 10,
    borderTopWidth: 1, borderLeftWidth: 1,
    borderTopColor: '#a8bac8', borderLeftColor: '#a8bac8',
  },
  description: { fontSize: 13, color: TEXT2, lineHeight: 20 },

  /* Footer */
  cardFooter: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: SEP, paddingTop: 8, gap: 8 },
  statutPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statutText: { fontSize: 11, fontWeight: '600' },
  syncChip:   { marginLeft: 'auto' as any, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  syncChipSynced:  { backgroundColor: Colors.successBg },
  syncChipPending: { backgroundColor: Colors.warningBg },
  syncText:        { fontSize: 11, fontWeight: '600' },

  /* État vide */
  empty:      { paddingTop: 70, alignItems: 'center', paddingHorizontal: 40 },
  emptyOuter: {
    borderRadius: 38, backgroundColor: NEO, marginBottom: 18,
    shadowColor: '#107a30', shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  emptyInner: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.successBg,
    shadowColor: '#d0fff0', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.9, shadowRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#d0fff0', borderLeftColor: '#d0fff0',
    borderBottomColor: Colors.successBorder, borderRightColor: Colors.successBorder,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: TEXT2, marginBottom: 8 },
  emptyText:  { fontSize: 13, color: TEXT3, textAlign: 'center', lineHeight: 20 },
});
