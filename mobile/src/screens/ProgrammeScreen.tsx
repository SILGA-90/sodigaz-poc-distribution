/**
 * Ecran d'un programme : liste des etapes (PLV) a visiter dans l'ordre.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
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
  const [progression, setProgression] = useState<{ visitees: number; echec: number; total: number }>(
    { visitees: 0, echec: 0, total: 0 },
  );
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

  // useCallback est requis AVANT le return anticipé ci-dessous (règle des hooks :
  // jamais après un return conditionnel).
  const renderEtape = useCallback(({ item }: { item: EtapeAvecPlv }): React.ReactElement => {
    const visite = item.statut_visite === 'VISITEE';
    const echec = item.statut_visite === 'ECHEC';
    const programmeCloture = programme?.statut === 'CLOTURE';
    const cardDisabled = programmeCloture || echec;

    const statusColor = visite ? '#198754' : echec ? '#dc3545' : '#f47920';
    const statusBg    = visite ? '#d1f5e0' : echec ? '#ffe4e6' : '#fff7ed';
    const badgeLabel  = visite ? 'Visitée' : echec ? 'Échec' : 'À visiter';
    const disabled    = echec || (programmeCloture && !visite);

    function handleCardPress() {
      if (visite) {
        if (item.op_sync_status === null) {
          // Étape visitée sur un autre appareil : l'opération n'est pas disponible hors ligne.
          Alert.alert(
            'Détail non disponible',
            "L'opération a été enregistrée sur un autre appareil et n'est pas accessible hors ligne.",
          );
          return;
        }
        navigation.navigate('EtapeDetail', { etapeId: item.id, etapeUuid: item.uuid });
      } else if (!disabled) {
        navigation.navigate('SaisieOperation', { etapeId: item.id });
      }
    }

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: statusColor }, disabled && styles.cardDisabled]}
        onPress={handleCardPress}
        activeOpacity={disabled ? 1 : 0.75}
      >
        {/* Ligne principale */}
        <View style={styles.cardMain}>
          <View style={[styles.ordreCircle, { backgroundColor: statusColor }]}>
            <Text style={styles.ordreText}>{item.ordre_prevu}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.plvLibelle}>{item.plv_libelle}</Text>
            <Text style={styles.clientName}>{item.client_raison_sociale}</Text>
          </View>
          <View style={styles.cardRight}>
            <View style={[styles.statutBadge, { backgroundColor: statusBg }]}>
              <Text style={[styles.statutText, { color: statusColor }]}>{badgeLabel}</Text>
            </View>
            {visite && item.op_sync_status !== null && (
              <View style={[
                styles.syncDot,
                item.op_sync_status === 'SYNCED' ? styles.syncDotGreen : styles.syncDotOrange,
              ]} />
            )}
          </View>
        </View>
        {/* Bouton itinéraire */}
        <TouchableOpacity
          style={styles.itineraireRow}
          onPress={(e) => { e.stopPropagation(); ouvrirItineraire(item.plv_latitude, item.plv_longitude); }}
          activeOpacity={0.65}
        >
          <Text style={styles.itineraireTxt}>Ouvrir l'itinéraire  ›</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [navigation, programme]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a7fba" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {programme && (
        <View style={styles.header}>
          <Text style={styles.numero}>{programme.numero_x3}</Text>
          <Text style={styles.meta}>
            {programme.type_programme === 'COLLECTE' ? 'Collecte' : 'Restitution'} · {programme.date_programme}
          </Text>
          <View style={styles.progressionRow}>
            <View style={styles.progressionBar}>
              <View style={[
                styles.progressionFill,
                { width: `${progression.total > 0 ? Math.round(progression.visitees / progression.total * 100) : 0}%` as any },
              ]} />
            </View>
            <Text style={styles.progressionLabel}>
              {progression.visitees}/{progression.total} visitées
            </Text>
            {progression.echec > 0 && (
              <View style={styles.echecCount}>
                <Text style={styles.echecCountText}>{progression.echec} échec</Text>
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
              onPress={() => navigation.navigate('MesAnomalies', {
                programmeUuid: programme.uuid,
                programmeNumero: programme.numero_x3,
              })}
            >
              <Text style={styles.voirAnomaliesLink}>Voir les anomalies &rsaquo;</Text>
            </TouchableOpacity>
            {programme.statut !== 'CLOTURE' && (
              <TouchableOpacity
                style={styles.clotureBtn}
                onPress={() => navigation.navigate('Cloture', { programmeId: programme.id })}
              >
                <Text style={styles.clotureBtnText}>Clôturer le programme</Text>
              </TouchableOpacity>
            )}
            {programme.statut === 'CLOTURE' && (
              <View style={styles.clotureBadge}>
                <Text style={styles.clotureBadgeText}>Programme clôturé — saisie impossible</Text>
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
        ListFooterComponent={<View style={{ height: 80 }} />}
      />
      {programme && programme.statut !== 'CLOTURE' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('Anomalie', {
            programmeUuid: programme.uuid,
            programmeId: programme.id,
          })}
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
  header: { backgroundColor: '#1a7fba', padding: 16 },
  numero: { fontSize: 18, fontWeight: '700', color: '#fff' },
  meta: { fontSize: 13, color: '#d0e8f5', marginTop: 2 },
  progressionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressionBar: {
    flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 4, overflow: 'hidden',
  },
  progressionFill: { height: 8, backgroundColor: '#fff', borderRadius: 4 },
  progressionLabel: { fontSize: 12, color: '#d0e8f5', fontWeight: '600' },
  echecCount: {
    backgroundColor: 'rgba(220,53,69,0.85)', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10,
  },
  echecCountText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  triBar: {
    flexDirection: 'row', marginTop: 12,
    backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 8, padding: 3, gap: 3,
  },
  triBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center' },
  triBtnActive: { backgroundColor: '#fff' },
  triBtnText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  triBtnTextActive: { color: '#1a7fba' },
  headerActions: { marginTop: 10, gap: 6 },
  voirAnomaliesLink: { fontSize: 13, color: '#d0e8f5', textDecorationLine: 'underline' },
  clotureBtn: {
    marginTop: 4, padding: 10, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
  },
  clotureBtnText: { color: '#fff', fontWeight: '700' },
  list: { padding: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#0a1628',
    shadowOpacity: 0.09,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: 'hidden',
  },
  cardMain: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, paddingBottom: 10,
  },
  ordreCircle: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12, flexShrink: 0,
  },
  ordreText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  plvLibelle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  clientName: { fontSize: 12, color: '#888', marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutText: { fontSize: 11, fontWeight: '700' },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncDotGreen: { backgroundColor: '#22c55e' },
  syncDotOrange: { backgroundColor: '#f97316' },
  itineraireRow: {
    borderTopWidth: 1, borderTopColor: '#f0f2f5',
    paddingVertical: 10, paddingHorizontal: 14,
    alignItems: 'flex-end',
  },
  itineraireTxt: { fontSize: 12, fontWeight: '700', color: '#1a7fba' },
  empty: { textAlign: 'center', color: '#888', padding: 32 },
  cardDisabled: { opacity: 0.45 },
  clotureBadge: {
    marginTop: 4, padding: 10, borderRadius: 8,
    backgroundColor: 'rgba(25,135,84,0.85)', alignItems: 'center',
  },
  clotureBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  fab: {
    position: 'absolute', bottom: 20, right: 16,
    backgroundColor: '#fd7e14',
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 30,
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
