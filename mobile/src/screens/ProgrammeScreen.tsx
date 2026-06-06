/**
 * Ecran d'un programme : liste des etapes (PLV) a visiter dans l'ordre.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  Alert,
  Linking,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapesDuProgramme,
  getProgrammeById,
  ProgrammeAvecProgression,
  EtapeAvecPlv,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Programme'>;

type TriMode = 'optimise' | 'alpha' | 'a_visiter';

const TRI_MODES: { key: TriMode; label: string }[] = [
  { key: 'optimise',  label: 'Circuit' },
  { key: 'alpha',     label: 'A-Z' },
  { key: 'a_visiter', label: 'A faire' },
];

function ouvrirItineraire(lat: number, lon: number): void {
  // Pas d'origin dans l'URL : Google Maps part de la position courante.
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir la navigation."));
}

export default function ProgrammeScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [progression, setProgression] = useState<{ visitees: number; echec: number; total: number }>({ visitees: 0, echec: 0, total: 0 });
  const [etapes, setEtapes] = useState<EtapeAvecPlv[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [triMode, setTriMode] = useState<TriMode>('optimise');

  const etapesTri = useMemo((): EtapeAvecPlv[] => {
    if (triMode === 'alpha') {
      return [...etapes].sort((a, b) => a.plv_libelle.localeCompare(b.plv_libelle, 'fr'));
    }
    if (triMode === 'a_visiter') {
      const ordre = { A_VISITER: 0, VISITEE: 1, ECHEC: 2 } as Record<string, number>;
      return [...etapes].sort((a, b) => (ordre[a.statut_visite] ?? 1) - (ordre[b.statut_visite] ?? 1));
    }
    return etapes; // 'optimise' : ordre DB conservé
  }, [etapes, triMode]);

  async function chargerDonnees() {
    const p = await getProgrammeById(programmeId);
    const e = await getEtapesDuProgramme(programmeId);
    setProgramme(p);
    setEtapes(e);
    setProgression({
      total: e.length,
      visitees: e.filter((x) => x.statut_visite === 'VISITEE').length,
      echec: e.filter((x) => x.statut_visite === 'ECHEC').length,
    });
  }

  useEffect(() => {
    (async () => {
      await chargerDonnees();
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
    const echec = item.statut_visite === 'ECHEC';
    const programmeCloture = programme?.statut === 'CLOTURE';
    const cardDisabled = programmeCloture || echec;

    let badgeStyle = styles.aVisiter;
    let badgeLabel = 'A visiter';
    if (visite) { badgeStyle = styles.visitee; badgeLabel = 'Visitee'; }
    if (echec)  { badgeStyle = styles.echecBadge; badgeLabel = 'Echec'; }

    function handleCardPress() {
      if (visite) {
        navigation.navigate('EtapeDetail', { etapeId: item.id, etapeUuid: item.uuid });
      } else if (!cardDisabled) {
        navigation.navigate('SaisieOperation', { etapeId: item.id });
      }
    }

    return (
      <TouchableOpacity
        style={[styles.card, (echec || (programmeCloture && !visite)) && styles.cardDisabled]}
        onPress={handleCardPress}
      >
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
        <View style={styles.actionsCol}>
          <View style={styles.statutRow}>
            <View style={[styles.statutBadge, badgeStyle]}>
              <Text style={[styles.statutText, echec && styles.statutTextEchec]}>{badgeLabel}</Text>
            </View>
            {visite && (
              <View style={[
                styles.syncDot,
                item.op_sync_status === 'SYNCED' ? styles.syncDotGreen : styles.syncDotOrange,
              ]} />
            )}
          </View>
          <TouchableOpacity
            style={styles.itineraireBtn}
            onPress={(e) => {
              e.stopPropagation();
              ouvrirItineraire(item.plv_latitude, item.plv_longitude);
            }}
          >
            <Text style={styles.itineraireBtnText}>Itineraire</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {programme && (
        <View style={styles.header}>
          <Text style={styles.numero}>{programme.numero_x3}</Text>
          <Text style={styles.meta}>
            {programme.type_programme} · {programme.date_programme}
          </Text>
          <View style={styles.progressionRow}>
            <View style={styles.progressionBar}>
              <View style={[
                styles.progressionFill,
                { width: `${progression.total > 0 ? Math.round(progression.visitees / progression.total * 100) : 0}%` as any },
              ]} />
            </View>
            <Text style={styles.progressionLabel}>
              {progression.visitees}/{progression.total} visitees
            </Text>
            {progression.echec > 0 && (
              <View style={styles.echecCount}>
                <Text style={styles.echecCountText}>{progression.echec} echec</Text>
              </View>
            )}
          </View>
          <View style={styles.triBar}>
            {TRI_MODES.map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[styles.triBtn, triMode === m.key && styles.triBtnActive]}
                onPress={() => setTriMode(m.key)}
              >
                <Text style={[styles.triBtnText, triMode === m.key && styles.triBtnTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('MesAnomalies', { programmeUuid: programme.uuid, programmeNumero: programme.numero_x3 })}
            >
              <Text style={styles.voirAnomaliesLink}>Voir les anomalies &rsaquo;</Text>
            </TouchableOpacity>
            {programme.statut !== 'CLOTURE' && (
              <TouchableOpacity
                style={styles.clotureBtn}
                onPress={() => navigation.navigate('Cloture', { programmeId: programme.id })}
              >
                <Text style={styles.clotureBtnText}>Cloturer le programme</Text>
              </TouchableOpacity>
            )}
            {programme.statut === 'CLOTURE' && (
              <View style={styles.clotureBadge}>
                <Text style={styles.clotureBadgeText}>Programme cloture — saisie impossible</Text>
              </View>
            )}
          </View>
        </View>
      )}
      <FlatList
        data={etapesTri}
        keyExtractor={(item) => item.uuid}
        renderItem={renderEtape}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucune etape dans ce programme.</Text>
        }
      />
      {programme && programme.statut !== 'CLOTURE' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('Anomalie', { programmeUuid: programme.uuid, programmeId: programme.id })}
        >
          <Text style={styles.fabText}>+ Anomalie</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  numero: { fontSize: 18, fontWeight: '700', color: '#333' },
  meta: { fontSize: 13, color: '#888', marginTop: 2 },
  progressionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressionBar: {
    flex: 1, height: 8, backgroundColor: '#e9ecef',
    borderRadius: 4, overflow: 'hidden',
  },
  progressionFill: { height: 8, backgroundColor: '#0d6efd', borderRadius: 4 },
  progressionLabel: { fontSize: 12, color: '#555', fontWeight: '600' },
  echecCount: {
    backgroundColor: '#f8d7da', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10,
  },
  echecCountText: { fontSize: 11, color: '#842029', fontWeight: '700' },
  triBar: {
    flexDirection: 'row', marginTop: 12,
    backgroundColor: '#f0f4ff', borderRadius: 8, padding: 3, gap: 3,
  },
  triBtn: {
    flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center',
  },
  triBtnActive: { backgroundColor: '#0d6efd' },
  triBtnText: { fontSize: 12, fontWeight: '600', color: '#6c757d' },
  triBtnTextActive: { color: '#fff' },
  headerActions: { marginTop: 10, gap: 6 },
  voirAnomaliesLink: { fontSize: 13, color: '#0d6efd', textDecorationLine: 'underline' },
  clotureBtn: {
    marginTop: 4, padding: 10, borderRadius: 8,
    backgroundColor: '#d1e7dd', borderWidth: 1, borderColor: '#198754',
    alignItems: 'center',
  },
  clotureBtnText: { color: '#0f5132', fontWeight: '700' },
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
  echecBadge: { backgroundColor: '#f8d7da' },
  statutText: { fontSize: 11, fontWeight: '700', color: '#333' },
  statutTextEchec: { color: '#842029' },
  actionsCol: { alignItems: 'flex-end' },
  statutRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncDotGreen: { backgroundColor: '#22c55e' },
  syncDotOrange: { backgroundColor: '#f97316' },
  itineraireBtn: {
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: '#cfe2ff', borderWidth: 1, borderColor: '#0d6efd',
  },
  itineraireBtnText: { fontSize: 11, fontWeight: '700', color: '#084298' },
  empty: { textAlign: 'center', color: '#888', padding: 32 },
  cardDisabled: { opacity: 0.5 },
  clotureBadge: {
    marginTop: 4, padding: 10, borderRadius: 8,
    backgroundColor: '#198754', alignItems: 'center',
  },
  clotureBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  fab: {
    position: 'absolute', bottom: 20, right: 20,
    backgroundColor: '#fd7e14',
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 30,
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
