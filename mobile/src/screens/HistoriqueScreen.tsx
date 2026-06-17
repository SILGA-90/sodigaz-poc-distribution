/**
 * Historique des programmes clôturés stockés localement.
 *
 * Liste tous les programmes avec statut CLOTURE présents dans la base
 * SQLite locale, du plus récent au plus ancien. Permet au livreur de
 * retrouver les détails d'une tournée passée (étapes, opérations) sans
 * accès réseau.
 *
 * Les programmes actifs
 * sont sur le DashboardScreen. L'historique est réservé aux tournées
 * terminées : séparation visuelle claire pour le livreur.
 *
 * Les données sont lues depuis SQLite.
 * Aucun pull n'est déclenché. Si le livreur veut voir des programmes
 * plus anciens (purgés après 90 jours), il doit synchroniser et
 * vérifier côté supervision web.
 *
 * On réutilise
 * ProgrammeScreen en lecture seule : même code de rendu des étapes
 * et opérations, sans duplication. La navigation passe programmeId
 * comme param.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getTousLesProgrammes, ProgrammeAvecProgression } from '../db/repositories/programmeRepository';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';
import { useLayout } from '../hooks/useLayout';

/* Palette néo claire */
const NEO     = '#e8edf2';
const NEO_SHD = '#4a6880';
const NEO_IN  = '#d4dde6';
const NAVY    = '#0a1628';
const TEXT    = '#1a2a3a';
const TEXT2   = '#3a5060';
const TEXT3   = '#3a5060';
const SEP     = '#c8d4de';

type Props = NativeStackScreenProps<RootStackParamList, 'Historique'>;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function statutInfo(statut: string): { color: string; bg: string; border: string; label: string } {
  if (statut === 'CLOTURE')  return { color: Colors.success,     bg: Colors.successBg, border: Colors.successBorder, label: 'Clôturé' };
  if (statut === 'EN_COURS') return { color: Colors.brandBlue,   bg: Colors.infoBg,    border: Colors.infoBorder,    label: 'En cours' };
  return                            { color: Colors.textMuted,   bg: NEO_IN,           border: SEP,                  label: 'Planifié' };
}

export default function HistoriqueScreen({ navigation }: Props): React.ReactElement {
  const { numColumns } = useLayout();
  const [programmes, setProgrammes] = useState<ProgrammeAvecProgression[]>([]);

  useEffect(() => {
    getTousLesProgrammes().then(setProgrammes);
  }, []);

  const renderItem = useCallback(({ item }: { item: ProgrammeAvecProgression }): React.ReactElement => {
    const pct        = item.total_etapes > 0 ? Math.round((item.etapes_visitees / item.total_etapes) * 100) : 0;
    const isCollecte = item.type_programme === 'COLLECTE';
    const st         = statutInfo(item.statut);

    return (
      <View style={[styles.cardOuter, numColumns > 1 && { flex: 1 }]}>
        <TouchableOpacity
          style={[styles.cardInner, { borderLeftColor: st.color }]}
          onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
          activeOpacity={0.82}
        >
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.numero}>{item.numero_x3}</Text>
              <View style={styles.metaRow}>
                <View style={[styles.typeChip, isCollecte ? styles.typeChipC : styles.typeChipR]}>
                  <Text style={[styles.typeChipText, isCollecte ? styles.typeChipTextC : styles.typeChipTextR]}>
                    {isCollecte ? 'Collecte' : 'Restitution'}
                  </Text>
                </View>
                <Text style={styles.dateLine}>{formatDate(item.date_programme)}</Text>
              </View>
            </View>
            {/* Statut pill */}
            <View style={[styles.statutPill, { backgroundColor: st.bg, borderColor: st.border }]}>
              <Text style={[styles.statutPillText, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>

          {/* Barre de progression inset */}
          <View style={styles.barRow}>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%` as `${number}%`, backgroundColor: st.color }]} />
            </View>
            <Text style={[styles.barLabel, { color: st.color }]}>{item.etapes_visitees}/{item.total_etapes}</Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [navigation, numColumns]);

  return (
    <View style={styles.root}>

      {/* Header navy */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerLabel}>Programmes locaux</Text>
            <Text style={styles.headerTitle}>Historique</Text>
          </View>
        </View>
      </View>

      {/* Liste */}
      <FlatList
        key={numColumns}
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
        style={styles.flatList}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyOuter}>
              <View style={styles.emptyInner}>
                <Ionicons name="calendar-outline" size={32} color={TEXT3} />
              </View>
            </View>
            <Text style={styles.emptyTitle}>Aucun programme clôturé</Text>
            <Text style={styles.emptyText}>Les programmes terminés apparaissent ici une fois clôturés.</Text>
          </View>
        }
      />
    </View>
  );
}

/* Styles */
const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: NEO },
  flatList: { flex: 1 },

  /* Header navy */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', width: 100, height: 100, borderRadius: 50,  top: 40,  right: 100, backgroundColor: 'rgba(7,155,217,0.07)' },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 52, paddingBottom: 20, paddingHorizontal: 16 },

  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.45)', letterSpacing: 1.2, textTransform: 'uppercase' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },

  list: { padding: 12, paddingBottom: 32 },

  /* Cartes raised + bande accent gauche */
  cardOuter: {
    marginBottom: 10,
    borderRadius: 14, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  cardInner: {
    borderRadius: 14, backgroundColor: NEO, padding: 14,
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 }, shadowOpacity: 1, shadowRadius: 7,
    /* bande accent = borderLeft coloré 4px ; top/bottom/right = biseau NEO */
    borderLeftWidth: 4,
    borderTopWidth: 1.5, borderTopColor: '#ffffff',
    borderBottomWidth: 1.5, borderBottomColor: '#8aa8c0',
    borderRightWidth: 1.5, borderRightColor: '#8aa8c0',
  },
  cardTop:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  numero:   { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 6 },
  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },

  typeChip:      { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  typeChipC:     { backgroundColor: Colors.infoBg,    borderColor: Colors.infoBorder },
  typeChipR:     { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  typeChipText:  { fontSize: 10, fontWeight: '700' },
  typeChipTextC: { color: Colors.brandBlue },
  typeChipTextR: { color: Colors.success },
  dateLine:      { fontSize: 12, color: TEXT3 },

  statutPill:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', borderWidth: 1 },
  statutPillText: { fontSize: 11, fontWeight: '700' },

  /* Barre de progression inset */
  barRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: {
    flex: 1, height: 7, borderRadius: 6, overflow: 'hidden',
    backgroundColor: NEO_IN,
    borderTopWidth: 1, borderLeftWidth: 1,
    borderTopColor: '#a8bac8', borderLeftColor: '#a8bac8',
  },
  barFill:  { height: 7, borderRadius: 6 },
  barLabel: { fontSize: 12, fontWeight: '700', minWidth: 36, textAlign: 'right' },

  /* État vide */
  empty:      { paddingTop: 70, alignItems: 'center', paddingHorizontal: 40 },
  emptyOuter: {
    borderRadius: 38, backgroundColor: NEO, marginBottom: 18,
    shadowColor: NEO_SHD, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 1, shadowRadius: 8, elevation: 7,
  },
  emptyInner: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: NEO,
    shadowColor: '#ffffff', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 1, shadowRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: TEXT2, marginBottom: 8 },
  emptyText:  { fontSize: 13, color: TEXT3, textAlign: 'center', lineHeight: 20 },
});
