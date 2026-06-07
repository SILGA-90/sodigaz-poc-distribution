/**
 * Ecran de cloture d'un programme : recapitulatif + confirmation.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getProgrammeById,
  getRecapProgramme,
  getOperationsRecapProgramme,
  cloturerProgrammeLocal,
  RecapProgramme,
  OperationRecap,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Cloture'>;

export default function ClotureScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [recap, setRecap] = useState<RecapProgramme | null>(null);
  const [operations, setOperations] = useState<OperationRecap[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [closing, setClosing] = useState<boolean>(false);
  const [clotureReussie, setClotureReussie] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      if (p) {
        const [r, ops] = await Promise.all([
          getRecapProgramme(programmeId, p.uuid),
          getOperationsRecapProgramme(programmeId),
        ]);
        setProgramme(p);
        setRecap(r);
        setOperations(ops);
      }
      setLoading(false);
    })();
  }, [programmeId]);

  function confirmerCloture(): void {
    if (!programme || !recap) return;
    const reste = recap.total_etapes - recap.etapes_visitees;
    const message = reste > 0
      ? `Attention : ${reste} etape(s) non visitee(s). Cloturer quand meme ?`
      : 'Toutes les etapes sont visitees. Confirmer la cloture ?';
    Alert.alert('Cloturer le programme', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Cloturer', style: 'destructive', onPress: faireCloture },
    ]);
  }

  async function faireCloture(): Promise<void> {
    if (!programme) return;
    setClosing(true);
    try {
      await cloturerProgrammeLocal(programme.uuid);
      setClotureReussie(true);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  if (!programme || !recap) {
    return (
      <View style={styles.center}>
        <Text>Programme introuvable.</Text>
      </View>
    );
  }

  const dejaCloture = programme.statut === 'CLOTURE';

  if (clotureReussie && recap) {
    const pct = recap.total_etapes > 0
      ? Math.round((recap.etapes_visitees / recap.total_etapes) * 100)
      : 0;
    return (
      <View style={styles.container}>
        <View style={styles.successHeader}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>Tournee terminee</Text>
          <Text style={styles.successSub}>{programme.numero_x3} · {programme.date_programme}</Text>
        </View>

        <View style={styles.recapCard}>
          <Text style={styles.recapTitle}>Bilan de la tournee</Text>

          <View style={styles.recapRow}>
            <Text style={styles.recapLabel}>Etapes visitees</Text>
            <Text style={styles.recapValue}>{recap.etapes_visitees} / {recap.total_etapes} ({pct} %)</Text>
          </View>
          {recap.etapes_echec > 0 && (
            <View style={styles.recapRow}>
              <Text style={styles.recapLabel}>Etapes en echec</Text>
              <Text style={[styles.recapValue, { color: '#dc3545' }]}>{recap.etapes_echec}</Text>
            </View>
          )}
          <View style={styles.recapRow}>
            <Text style={styles.recapLabel}>Operations realisees</Text>
            <Text style={styles.recapValue}>{recap.nb_operations}</Text>
          </View>
          <View style={styles.recapRow}>
            <Text style={styles.recapLabel}>Montant encaisse</Text>
            <Text style={[styles.recapValue, { color: '#198754' }]}>
              {recap.montant_encaisse.toLocaleString('fr-FR')} FCFA
            </Text>
          </View>
          {recap.nb_anomalies > 0 && (
            <View style={styles.recapRow}>
              <Text style={styles.recapLabel}>Anomalies signalees</Text>
              <Text style={[styles.recapValue, { color: '#ffc107' }]}>{recap.nb_anomalies}</Text>
            </View>
          )}
        </View>

        <View style={styles.syncNotice}>
          <Text style={styles.syncNoticeText}>
            Synchronisez des que possible pour remonter vos donnees au superviseur.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('Dashboard')}
        >
          <Text style={styles.buttonText}>Retour au tableau de bord</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={styles.header}>
        <Text style={styles.numero}>{programme.numero_x3}</Text>
        <Text style={styles.meta}>{programme.type_programme} - {programme.date_programme}</Text>
      </View>

      <View style={styles.recapCard}>
        <Text style={styles.recapTitle}>Recapitulatif de la tournee</Text>
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Etapes visitees</Text>
          <Text style={styles.recapValue}>{recap.etapes_visitees} / {recap.total_etapes}</Text>
        </View>
        {recap.etapes_echec > 0 && (
          <View style={styles.recapRow}>
            <Text style={styles.recapLabel}>Etapes en echec</Text>
            <Text style={[styles.recapValue, { color: '#dc3545' }]}>{recap.etapes_echec}</Text>
          </View>
        )}
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Operations realisees</Text>
          <Text style={styles.recapValue}>{recap.nb_operations}</Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Montant encaisse</Text>
          <Text style={[styles.recapValue, { color: '#198754' }]}>
            {recap.montant_encaisse.toLocaleString('fr-FR')} FCFA
          </Text>
        </View>
        {recap.nb_anomalies > 0 && (
          <View style={styles.recapRow}>
            <Text style={styles.recapLabel}>Anomalies signalees</Text>
            <Text style={[styles.recapValue, { color: '#ffc107' }]}>{recap.nb_anomalies}</Text>
          </View>
        )}
      </View>

      {operations.length > 0 && (
        <View style={styles.recapCard}>
          <Text style={styles.recapTitle}>Detail des operations</Text>
          {operations.map((op, i) => (
            <View key={i} style={styles.opRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.opPlv}>{op.plv_libelle}</Text>
                <Text style={styles.opType}>{op.type_operation}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.opMontant}>
                  {op.montant_total.toLocaleString('fr-FR')} FCFA
                </Text>
                <Text style={[styles.opEncaisse, { color: op.est_encaissee ? '#198754' : '#dc3545' }]}>
                  {op.est_encaissee ? 'Encaisse' : 'Non encaisse'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {dejaCloture ? (
        <View style={styles.clotureBadge}>
          <Text style={styles.clotureBadgeText}>Programme deja cloture</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.button, closing && styles.buttonDisabled]}
          onPress={confirmerCloture}
          disabled={closing}
        >
          {closing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Cloturer le programme</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#0d6efd', padding: 16 },
  numero: { color: '#fff', fontSize: 18, fontWeight: '700' },
  meta: { color: '#cbe2ff', fontSize: 14, marginTop: 4 },
  recapCard: { backgroundColor: '#fff', margin: 16, padding: 16, borderRadius: 12 },
  recapTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 12 },
  recapRow: {
    flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  recapLabel: { fontSize: 14, color: '#666', flexShrink: 1, marginRight: 8 },
  recapValue: { fontSize: 15, fontWeight: '700', color: '#0d6efd' },
  button: {
    backgroundColor: '#198754', marginHorizontal: 16, padding: 16,
    borderRadius: 10, alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  clotureBadge: {
    marginHorizontal: 16, padding: 16, borderRadius: 10,
    backgroundColor: '#d1e7dd', alignItems: 'center',
  },
  clotureBadgeText: { color: '#0f5132', fontWeight: '700' },
  successHeader: {
    backgroundColor: '#198754', padding: 32, alignItems: 'center',
  },
  successIcon: { fontSize: 56, color: '#fff', fontWeight: '700' },
  successTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 8 },
  successSub: { color: '#a3cfbb', fontSize: 14, marginTop: 4 },
  opRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  opPlv: { fontSize: 13, fontWeight: '600', color: '#333' },
  opType: { fontSize: 11, color: '#888', marginTop: 2 },
  opMontant: { fontSize: 13, fontWeight: '700', color: '#333' },
  opEncaisse: { fontSize: 11, marginTop: 2 },
  syncNotice: {
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    backgroundColor: '#fff3cd', borderRadius: 8,
    borderLeftWidth: 4, borderLeftColor: '#ffc107',
  },
  syncNoticeText: { fontSize: 13, color: '#664d03', lineHeight: 18 },
});
