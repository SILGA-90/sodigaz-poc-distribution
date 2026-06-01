/**
 * Ecran de cloture d'un programme : recapitulatif + confirmation.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getProgrammeById,
  getRecapProgramme,
  cloturerProgrammeLocal,
  RecapProgramme,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Cloture'>;

export default function ClotureScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [recap, setRecap] = useState<RecapProgramme | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [closing, setClosing] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      if (p) {
        const r = await getRecapProgramme(programmeId, p.uuid);
        setProgramme(p);
        setRecap(r);
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
      Alert.alert(
        'Programme cloture',
        'Le programme est cloture. Il sera remonte au superviseur a la prochaine synchronisation.',
        [{ text: 'OK', onPress: () => navigation.navigate('Dashboard') }],
      );
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

  return (
    <View style={styles.container}>
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
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Operations realisees</Text>
          <Text style={styles.recapValue}>{recap.nb_operations}</Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Montant encaisse</Text>
          <Text style={styles.recapValue}>{recap.montant_encaisse.toLocaleString('fr-FR')} FCFA</Text>
        </View>
        <View style={styles.recapRow}>
          <Text style={styles.recapLabel}>Anomalies signalees</Text>
          <Text style={styles.recapValue}>{recap.nb_anomalies}</Text>
        </View>
      </View>

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
    </View>
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
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  recapLabel: { fontSize: 14, color: '#666' },
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
});
