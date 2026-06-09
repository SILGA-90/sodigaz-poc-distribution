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
    const isCollecte = item.type_programme === 'COLLECTE';
    const statutColor =
      item.statut === 'CLOTURE' ? '#198754' :
      item.statut === 'EN_COURS' ? '#1a7fba' : '#6c757d';
    const statutBg =
      item.statut === 'CLOTURE' ? '#d1f5e0' :
      item.statut === 'EN_COURS' ? '#dbeafe' : '#f0f0f0';
    const statutLabel =
      item.statut === 'CLOTURE' ? 'Clôturé' :
      item.statut === 'EN_COURS' ? 'En cours' : 'Planifié';

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: statutColor }]}
        onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.numero}>{item.numero_x3}</Text>
            <Text style={styles.dateLine}>
              <Text style={[styles.typeChip, isCollecte ? styles.chipCol : styles.chipRes]}>
                {isCollecte ? ' Collecte ' : ' Restitution '}
              </Text>
              {'  ·  '}{formatDate(item.date_programme)}
            </Text>
          </View>
          <View style={[styles.statutPill, { backgroundColor: statutBg }]}>
            <Text style={[styles.statutPillText, { color: statutColor }]}>{statutLabel}</Text>
          </View>
        </View>
        <View style={styles.barRow}>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: statutColor }]} />
          </View>
          <Text style={[styles.barLabel, { color: statutColor }]}>
            {item.etapes_visitees}/{item.total_etapes}
          </Text>
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
            <Text style={styles.emptyText}>Aucun programme synchronisé.</Text>
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
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#0a1628',
    shadowOpacity: 0.09,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  numero: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  dateLine: { fontSize: 12, color: '#888' },
  typeChip: { fontSize: 10, fontWeight: '700', borderRadius: 4, overflow: 'hidden' },
  chipCol: { color: '#1d4ed8', backgroundColor: '#dbeafe' },
  chipRes: { color: '#166534', backgroundColor: '#dcfce7' },
  statutPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignSelf: 'flex-start' },
  statutPillText: { fontSize: 11, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  barTrack: { flex: 1, height: 8, backgroundColor: '#eef1f6', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barLabel: { fontSize: 12, fontWeight: '700', minWidth: 36, textAlign: 'right' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#aaa', fontSize: 14 },
});
