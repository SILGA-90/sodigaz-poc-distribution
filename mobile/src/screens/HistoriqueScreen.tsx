/**
 * Historique de tous les programmes stockés localement.
 * Design néomorphisme sombre.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getTousLesProgrammes, ProgrammeAvecProgression } from '../db/repositories/programmeRepository';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

// ── Palette néomorphisme ─────────────────────────────────────────────────────
const BASE    = '#0d1e35';
const SURFACE = '#112240';
const DEEPER  = '#07111e';
const LIFT    = 'rgba(255,255,255,0.06)';
const INSET   = '#091527';

type Props = NativeStackScreenProps<RootStackParamList, 'Historique'>;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export default function HistoriqueScreen({ navigation }: Props): React.ReactElement {
  const [programmes, setProgrammes] = useState<ProgrammeAvecProgression[]>([]);

  useEffect(() => {
    getTousLesProgrammes().then(setProgrammes);
  }, []);

  const renderItem = useCallback(({ item }: { item: ProgrammeAvecProgression }): React.ReactElement => {
    const pct = item.total_etapes > 0
      ? Math.round((item.etapes_visitees / item.total_etapes) * 100) : 0;
    const isCollecte = item.type_programme === 'COLLECTE';

    const statutColor =
      item.statut === 'CLOTURE'   ? '#34d399' :
      item.statut === 'EN_COURS'  ? Colors.brandBlue : '#64748b';
    const statutBg =
      item.statut === 'CLOTURE'   ? 'rgba(52,211,153,0.12)' :
      item.statut === 'EN_COURS'  ? 'rgba(7,155,217,0.12)'  : 'rgba(100,116,139,0.12)';
    const statutLabel =
      item.statut === 'CLOTURE'   ? 'Clôturé' :
      item.statut === 'EN_COURS'  ? 'En cours' : 'Planifié';

    return (
      <View style={styles.cardOuter}>
        <TouchableOpacity
          style={[styles.card, { borderLeftColor: statutColor }]}
          onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
          activeOpacity={0.8}
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
            <View style={[styles.statutPill, { backgroundColor: statutBg, borderColor: statutColor }]}>
              <Text style={[styles.statutPillText, { color: statutColor }]}>{statutLabel}</Text>
            </View>
          </View>

          {/* Barre de progression — INSET creusée */}
          <View style={styles.barRow}>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: statutColor }]} />
            </View>
            <Text style={[styles.barLabel, { color: statutColor }]}>
              {item.etapes_visitees}/{item.total_etapes}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [navigation]);

  return (
    <View style={styles.root}>
      {/* ══ HEADER ══ */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtnWrap} activeOpacity={0.7}>
            <View style={styles.backBtnOuter}>
              <View style={styles.backBtn}>
                <Text style={styles.backBtnText}>‹</Text>
              </View>
            </View>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerLabel}>Programmes locaux</Text>
            <Text style={styles.headerTitle}>Historique</Text>
          </View>
        </View>
      </View>

      {/* ══ LISTE ══ */}
      <FlatList
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconOuter}>
              <View style={styles.emptyIconBox}>
                <Text style={styles.emptyIconText}>○</Text>
              </View>
            </View>
            <Text style={styles.emptyTitle}>Aucun programme</Text>
            <Text style={styles.emptyText}>
              Synchronise d'abord pour charger les programmes disponibles.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BASE },

  // Header
  header: { backgroundColor: BASE, overflow: 'hidden' },
  bubble1:{ position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(7,155,217,0.08)' },
  bubble2:{ position: 'absolute', width: 100, height: 100, borderRadius: 50,  top: 40,  right: 100, backgroundColor: 'rgba(7,155,217,0.05)' },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 52, paddingBottom: 20, paddingHorizontal: 16 },

  backBtnWrap: {},
  backBtnOuter: { borderRadius: 12, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.85, shadowRadius: 6, elevation: 4 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  backBtnText: { fontSize: 24, color: '#fff', lineHeight: 28, fontWeight: '700' },

  headerLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.35)', letterSpacing: 1.2, textTransform: 'uppercase' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },

  list: { padding: 12, paddingBottom: 32 },

  // Cartes
  cardOuter: { marginBottom: 10, borderRadius: 16, shadowColor: DEEPER, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.85, shadowRadius: 12, elevation: 6 },
  card: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: LIFT, borderLeftColor: LIFT,
    borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)',
    borderLeftWidth: 4,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  numero:  { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  typeChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  typeChipC: { backgroundColor: 'rgba(7,155,217,0.12)',  borderColor: 'rgba(7,155,217,0.3)' },
  typeChipR: { backgroundColor: 'rgba(52,211,153,0.12)', borderColor: 'rgba(52,211,153,0.3)' },
  typeChipText: { fontSize: 10, fontWeight: '700' },
  typeChipTextC: { color: Colors.brandBlue },
  typeChipTextR: { color: '#34d399' },
  dateLine: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },

  statutPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', borderWidth: 1 },
  statutPillText: { fontSize: 11, fontWeight: '700' },

  // Barre de progression
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: {
    flex: 1, height: 6, borderRadius: 6, overflow: 'hidden',
    backgroundColor: INSET,
    borderTopWidth: 1, borderLeftWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.4)', borderLeftColor: 'rgba(0,0,0,0.4)',
  },
  barFill:  { height: 6, borderRadius: 6 },
  barLabel: { fontSize: 12, fontWeight: '700', minWidth: 36, textAlign: 'right' },

  // État vide
  empty: { paddingTop: 70, alignItems: 'center', paddingHorizontal: 40 },
  emptyIconOuter: { borderRadius: 38, shadowColor: DEEPER, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.85, shadowRadius: 10, elevation: 6, marginBottom: 18 },
  emptyIconBox: { width: 76, height: 76, borderRadius: 38, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  emptyIconText: { fontSize: 32, color: 'rgba(255,255,255,0.15)' },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: 'rgba(255,255,255,0.5)', marginBottom: 8 },
  emptyText:  { fontSize: 13, color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 20 },
});
