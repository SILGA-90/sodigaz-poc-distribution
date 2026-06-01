/**
 * Ecran de signalement d'une anomalie sur un programme.
 * Type + gravite + description + photo(s) optionnelle(s) + geolocalisation.
 * Enregistrement local PENDING (offline-first), remonte a la sync.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { creerAnomalie } from '../db/repositories/anomalieRepository';
import { ajouterPhotoAnomalie } from '../db/repositories/photoRepository';
import { getCurrentPosition } from '../services/locationService';
import PhotosSection, { PhotoEnAttente } from '../components/PhotosSection';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Anomalie'>;

const TYPES_ANOMALIE = [
  'PLV ferme',
  'Client absent',
  'Refus de paiement',
  'Produit endommage',
  'Acces impossible',
  'Autre',
];

const GRAVITES: { label: string; value: 'FAIBLE' | 'MOYENNE' | 'ELEVEE'; color: string }[] = [
  { label: 'Faible', value: 'FAIBLE', color: '#198754' },
  { label: 'Moyenne', value: 'MOYENNE', color: '#ffc107' },
  { label: 'Elevee', value: 'ELEVEE', color: '#dc3545' },
];

export default function AnomalieScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeUuid } = route.params;

  const [typeAnomalie, setTypeAnomalie] = useState<string>(TYPES_ANOMALIE[0]);
  const [gravite, setGravite] = useState<'FAIBLE' | 'MOYENNE' | 'ELEVEE'>('MOYENNE');
  const [description, setDescription] = useState<string>('');
  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLon, setGpsLon] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'en cours' | 'ok' | 'indisponible'>('en cours');
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const pos = await getCurrentPosition();
        if (pos) {
          setGpsLat(pos.latitude);
          setGpsLon(pos.longitude);
          setGpsStatus('ok');
        } else {
          setGpsStatus('indisponible');
        }
      } catch {
        setGpsStatus('indisponible');
      }
    })();
  }, []);

  async function handleSave(): Promise<void> {
    if (!description.trim()) {
      Alert.alert('Description manquante', 'Decris brievement l\'anomalie.');
      return;
    }
    setSaving(true);
    try {
      const anomalieUuid = await creerAnomalie({
        programme_uuid: programmeUuid,
        plv_id: null,
        type_anomalie: typeAnomalie,
        gravite,
        description: description.trim(),
        latitude: gpsLat,
        longitude: gpsLon,
      });

      for (const ph of photos) {
        await ajouterPhotoAnomalie(anomalieUuid, ph.uri, ph.tailleOctets, gpsLat, gpsLon);
      }

      Alert.alert(
        'Anomalie enregistree',
        'L\'anomalie est enregistree localement. Elle sera remontee a la prochaine synchronisation.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Signaler une anomalie</Text>
        <Text style={styles.gpsStatus}>Position GPS : {gpsStatus}</Text>
      </View>

      <Text style={styles.sectionTitle}>Type d'anomalie</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={typeAnomalie} onValueChange={(v) => setTypeAnomalie(v)}>
          {TYPES_ANOMALIE.map((t) => (
            <Picker.Item key={t} label={t} value={t} />
          ))}
        </Picker>
      </View>

      <Text style={styles.sectionTitle}>Gravite</Text>
      <View style={styles.graviteRow}>
        {GRAVITES.map((g) => (
          <TouchableOpacity
            key={g.value}
            style={[
              styles.graviteChip,
              gravite === g.value && { backgroundColor: g.color, borderColor: g.color },
            ]}
            onPress={() => setGravite(g.value)}
          >
            <Text style={[styles.graviteText, gravite === g.value && styles.graviteTextActive]}>
              {g.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Description</Text>
      <TextInput
        style={styles.description}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Decris l'anomalie rencontree..."
      />

      <Text style={styles.sectionTitle}>Photo (optionnel)</Text>
      <PhotosSection
        photos={photos}
        onChange={setPhotos}
        types={[{ label: 'Anomalie', value: 'ANOMALIE' }]}
      />

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>Enregistrer l'anomalie</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#dc3545', padding: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  gpsStatus: { color: '#ffd9dd', fontSize: 12, marginTop: 4 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: '#333',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  pickerWrap: {
    backgroundColor: '#fff', marginHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#ccc',
  },
  graviteRow: { flexDirection: 'row', gap: 8, marginHorizontal: 12 },
  graviteChip: {
    flex: 1, padding: 12, borderRadius: 8, alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc',
  },
  graviteText: { fontWeight: '600', color: '#333' },
  graviteTextActive: { color: '#fff' },
  description: {
    backgroundColor: '#fff', marginHorizontal: 12, padding: 12,
    borderRadius: 10, minHeight: 90, textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: '#dc3545', margin: 16, padding: 16,
    borderRadius: 10, alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
