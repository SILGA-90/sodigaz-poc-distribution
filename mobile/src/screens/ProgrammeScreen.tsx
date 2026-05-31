/**
 * Ecran d'un programme : liste des etapes (PLV) a visiter dans l'ordre.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapesDuProgramme,
  getProgrammeById,
  EtapeAvecPlv,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Programme'>;

export default function ProgrammeScreen({ route }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [etapes, setEtapes] = useState<EtapeAvecPlv[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      const e = await getEtapesDuProgramme(programmeId);
      setProgramme(p);
      setEtapes(e);
      setLoading(false);
    })();
  }, [programmeId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  function renderEtape({ item }: { item: EtapeAvecPlv }): React.ReactElement {
    const visite = item.statut_visite === 'VISITEE';
    return (
      <View style={styles.card}>
        <View style={styles.ordreCircle}>
          <Text style={styles.ordreText}>{item.ordre_prevu}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.plvLibelle}>{item.plv_libelle}</Text>
          <Text style={styles.clientName}>{item.client_raison_sociale}</Text>
          <Text style={styles.coords}>
            {item.plv_latitude.toFixed(4)}, {item.plv_longitude.toFixed(4)}
          </Text>
        </View>
        <View style={[styles.statutBadge, visite ? styles.visitee : styles.aVisiter]}>
          <Text style={styles.statutText}>{visite ? 'Visitee' : 'A visiter'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {programme && (
        <View style={styles.header}>
          <Text style={styles.numero}>{programme.numero_x3}</Text>
          <Text style={styles.meta}>
            {programme.type_programme} - {programme.date_programme}
          </Text>
        </View>
      )}
      <FlatList
        data={etapes}
        keyExtractor={(item) => item.uuid}
        renderItem={renderEtape}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucune etape dans ce programme.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  numero: { fontSize: 18, fontWeight: '700', color: '#333' },
  meta: { fontSize: 14, color: '#888', marginTop: 4 },
  list: { padding: 12 },
  card: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ordreCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#0d6efd',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  ordreText: { color: '#fff', fontWeight: '700' },
  plvLibelle: { fontSize: 15, fontWeight: '600', color: '#333' },
  clientName: { fontSize: 13, color: '#666', marginTop: 2 },
  coords: { fontSize: 11, color: '#aaa', marginTop: 2, fontFamily: 'monospace' },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  visitee: { backgroundColor: '#d1e7dd' },
  aVisiter: { backgroundColor: '#fff3cd' },
  statutText: { fontSize: 11, fontWeight: '700', color: '#333' },
  empty: { textAlign: 'center', color: '#888', padding: 32 },
});
