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
      ? Math.round((item.etapes_visitees / item.total_etapes) * 100)
      : 0;
    const statutColor =
      item.statut === 'CLOTURE' ? '#198754' :
      item.statut === 'EN_COURS' ? '#1a7fba' : '#6c757d';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.numero}>{item.numero_x3}</Text>
          <View style={[styles.badge, item.type_programme === 'COLLECTE' ? styles.badgeCol : styles.badgeRes]}>
            <Text style={styles.badgeText}>{item.type_programme === 'COLLECTE' ? 'Collecte' : 'Restitution'}</Text>
          </View>
        </View>
        <Text style={styles.date}>{formatDate(item.date_programme)}</Text>
        <View style={styles.progressRow}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: statutColor }]} />
          </View>
          <Text style={[styles.progressLabel, { color: statutColor }]}>
            {item.etapes_visitees}/{item.total_etapes} etapes
          </Text>
          <View style={[styles.statutBadge, { backgroundColor: statutColor }]}>
            <Text style={styles.statutText}>
              {item.statut === 'CLOTURE' ? 'Cloture' : item.statut === 'EN_COURS' ? 'En cours' : 'Planifie'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Historique</Text>
      </View>
      <FlatList
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Aucun programme synchronise.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#1a7fba', paddingTop: 48, paddingBottom: 16,
    paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  backBtn: { paddingRight: 8 },
  backText: { color: '#d0e8f5', fontSize: 18 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  list: { padding: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  numero: { fontSize: 14, fontWeight: '700', color: '#1a1a2e' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeCol: { backgroundColor: '#dbeafe' },
  badgeRes: { backgroundColor: '#dcfce7' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#333' },
  date: { color: '#999', fontSize: 12, marginTop: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressBar: { flex: 1, height: 5, backgroundColor: '#e9ecef', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  progressLabel: { fontSize: 11, fontWeight: '600', minWidth: 60 },
  statutBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  statutText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#aaa', fontSize: 14 },
});
