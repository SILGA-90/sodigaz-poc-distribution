/**
 * Liste des anomalies d'un programme : vue lecture.
 *
 * Affiche les anomalies signalées par le livreur pendant une tournée,
 * avec leur type, gravité, statut (OUVERTE / EN_TRAITEMENT / RESOLUE),
 * description et état de synchronisation (PENDING / SYNCED). Accessible
 * depuis ProgrammeScreen via le compteur d'anomalies.
 *
 * Le livreur doit savoir si ses anomalies ont
 * bien été envoyées au superviseur. Un badge orange "En attente de sync"
 * sur une anomalie PENDING lui rappelle de synchroniser quand il a
 * du réseau.
 *
 * Le tri par date décroissante est recalculé
 * uniquement quand la liste des anomalies change, pas à chaque render.
 *
 * Gravité FAIBLE -> bleu info,
 * MOYENNE -> warning, ELEVEE -> danger. Code couleur identique côté
 * supervision web pour la cohérence du système de design SODIGAZ.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getAnomaliesDuProgramme, AnomalieLocale } from '../db/repositories/anomalieRepository';
import { RootStackParamList } from '../types/navigation';
import { Colors, scale } from '../theme';

/* Palette */
const NEO    = '#F2F4F6';
const NEO_IN = '#E8EEF2';
const NAVY   = '#0a1628';
const TEXT   = '#1a2a3a';
const TEXT2  = '#3a5060';
const TEXT3  = '#5B6770';
const SEP    = '#DDE2E6';

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
  OUVERTE:  { label: 'Ouverte',  color: Colors.danger,   bg: Colors.dangerBg,  border: Colors.dangerBorder  },
  EN_COURS: { label: 'En cours', color: Colors.warning,   bg: Colors.warningBg, border: Colors.warningBorder },
  RESOLUE:  { label: 'Résolue',  color: Colors.success,   bg: Colors.successBg, border: Colors.successBorder },
  CLASSEE:  { label: 'Classée',  color: Colors.textMuted, bg: NEO_IN,           border: SEP                  },
};

export default function MesAnomaliesScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeUuid, programmeNumero } = route.params;
  const { width } = useWindowDimensions();
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
      <View style={[styles.card, { borderLeftColor: gcfg.color }]}>
        {/* Ligne principale */}
        <View style={styles.cardTop}>
          <View style={[styles.iconBox, { backgroundColor: gcfg.bg, borderColor: gcfg.border }]}>
            <Ionicons name={meta.icon} size={20} color={gcfg.color} />
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.typeLabel}>{meta.label}</Text>
            <Text style={styles.dateText}>{date}</Text>
          </View>
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
    );
  }

  return (
    <View style={styles.root}>

      {/* Header navy (bulles danger) */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerText}>
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
      </View>

      {/* Liste */}
      <FlatList
        data={anomalies}
        keyExtractor={(item) => item.uuid}
        renderItem={renderItem}
        style={styles.flatList}
        contentContainerStyle={[styles.list, width >= 700 && styles.wideContent]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="checkmark-circle" size={34} color={Colors.success} />
            </View>
            <Text style={styles.emptyTitle}>Aucune anomalie</Text>
            <Text style={styles.emptyText}>Ce programme ne comporte aucun signalement.</Text>
          </View>
        }
      />
    </View>
  );
}

/* Styles */
const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: NEO },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO },

  /* Header navy */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(220,38,38,0.1)' },
  bubble2: { position: 'absolute', width: 130, height: 130, borderRadius: 65, bottom: -40, left: -25, backgroundColor: 'rgba(220,38,38,0.07)' },
  headerContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 24 },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2, flexShrink: 0,
  },
  headerText:   { flex: 1 },
  headerLabel:  { color: 'rgba(255,255,255,0.45)', fontSize: scale(11), fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2 },
  headerNumero: { color: '#fff', fontSize: scale(22), fontWeight: '800', marginBottom: 16 },

  /* Stats glass chips */
  statsRow: { flexDirection: 'row', gap: 8 },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  statNum: { fontSize: scale(16), fontWeight: '800', lineHeight: 20 },
  statLbl: { fontSize: scale(10), fontWeight: '500' },
  headerZero: { color: 'rgba(255,255,255,0.35)', fontSize: scale(13), fontStyle: 'italic' },

  flatList:    { flex: 1 },
  list:        { padding: 14, paddingTop: 16, paddingBottom: 32 },
  wideContent: { maxWidth: 700, alignSelf: 'center', width: '100%' },

  /* Carte anomalie avec bande accent gauche */
  card: {
    marginBottom: 10, borderRadius: 14, backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#DDE2E6',
    borderBottomWidth: 1, borderBottomColor: '#DDE2E6',
    borderRightWidth: 1, borderRightColor: '#DDE2E6',
    borderLeftWidth: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    paddingHorizontal: 14, paddingTop: 13, paddingBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },

  iconBox: {
    width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1,
  },
  cardMeta:  { flex: 1 },
  typeLabel: { fontSize: scale(14), fontWeight: '700', color: TEXT, marginBottom: 2 },
  dateText:  { fontSize: scale(12), color: TEXT3 },

  gravitePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  graviteText: { fontSize: scale(11), fontWeight: '700' },

  /* Description */
  descBox: {
    backgroundColor: NEO_IN, borderRadius: 8, padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: '#DDE2E6',
  },
  description: { fontSize: scale(13), color: TEXT2, lineHeight: 20 },

  /* Footer */
  cardFooter: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: SEP, paddingTop: 8, gap: 8 },
  statutPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statutText: { fontSize: scale(11), fontWeight: '600' },
  syncChip:   { marginLeft: 'auto' as 'auto', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  syncChipSynced:  { backgroundColor: Colors.successBg },
  syncChipPending: { backgroundColor: Colors.warningBg },
  syncText:        { fontSize: scale(11), fontWeight: '600' },

  /* État vide */
  empty:         { paddingTop: 70, alignItems: 'center', paddingHorizontal: 40 },
  emptyIconWrap: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: Colors.successBg, borderWidth: 1, borderColor: Colors.successBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  emptyTitle: { fontSize: scale(17), fontWeight: '700', color: TEXT2, marginBottom: 8 },
  emptyText:  { fontSize: scale(13), color: TEXT3, textAlign: 'center', lineHeight: 20 },
});
