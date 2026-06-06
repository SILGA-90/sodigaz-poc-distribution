import React, { useEffect, useState } from 'react';
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

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#0d6efd" /></View>;
  }

  function renderItem({ item }: { item: AnomalieLocale }): React.ReactElement {
    const synced = item.sync_status === 'SYNCED';
    const date = new Date(item.date_heure).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.typeText}>{item.type_anomalie}</Text>
          <View style={styles.aClasSerBadge}>
            <Text style={styles.aClasserText}>A classer</Text>
          </View>
        </View>
        {item.description ? (
          <Text style={styles.description}>{item.description}</Text>
        ) : null}
        <View style={styles.footer}>
          <Text style={styles.date}>{date}</Text>
          <View style={[styles.syncChip, synced ? styles.syncedBg : styles.pendingBg]}>
            <Text style={styles.syncText}>{synced ? 'Synchronisee' : 'En attente'}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Anomalies — {programmeNumero}</Text>
        <Text style={styles.headerSub}>{anomalies.length} signalement{anomalies.length > 1 ? 's' : ''}</Text>
      </View>
      <FlatList
        data={anomalies}
        keyExtractor={(item) => item.uuid}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Aucune anomalie</Text>
            <Text style={styles.emptyText}>Aucun signalement pour ce programme.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#0d6efd', padding: 16 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerSub: { color: '#cbe2ff', fontSize: 13, marginTop: 2 },
  list: { padding: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14,
    marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeText: { fontSize: 14, fontWeight: '700', color: '#333', flex: 1, marginRight: 8 },
  aClasSerBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
    backgroundColor: '#e9ecef',
  },
  aClasserText: { fontSize: 11, fontWeight: '600', color: '#6c757d' },
  description: { fontSize: 13, color: '#555', lineHeight: 18, marginBottom: 10 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 12, color: '#aaa' },
  syncChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  syncedBg: { backgroundColor: '#d1e7dd' },
  pendingBg: { backgroundColor: '#fff3cd' },
  syncText: { fontSize: 11, fontWeight: '600', color: '#333' },
  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#888', marginBottom: 8 },
  emptyText: { color: '#aaa', textAlign: 'center' },
});
