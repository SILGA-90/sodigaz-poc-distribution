/**
 * Ecran de signalement d'une anomalie sur un programme.
 * Type + description + photo(s) optionnelle(s) + geolocalisation.
 * La gravite est fixee a MOYENNE par defaut ; le superviseur la reclassifie.
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
import { getEtapesDuProgramme } from '../db/repositories/programmeRepository';
import { ajouterPhotoAnomalie } from '../db/repositories/photoRepository';
import { acquerirPositionProbante } from '../services/locationService';
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


export default function AnomalieScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeUuid, programmeId } = route.params;

  const [typeAnomalie, setTypeAnomalie] = useState<string>(TYPES_ANOMALIE[0]);
  const [description, setDescription] = useState<string>('');
  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLon, setGpsLon] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'en cours' | 'fiable' | 'degradee' | 'indisponible'>('en cours');
  const [saving, setSaving] = useState<boolean>(false);
  const [plvOptions, setPlvOptions] = useState<{ id: number; libelle: string }[]>([]);
  const [selectedPlvId, setSelectedPlvId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pos = await acquerirPositionProbante();
        setGpsLat(pos.latitude);
        setGpsLon(pos.longitude);
        setGpsStatus(pos.qualite === 'absente' ? 'indisponible' : pos.qualite);
      } catch {
        setGpsStatus('indisponible');
      }
    })();
  }, []);

  useEffect(() => {
    getEtapesDuProgramme(programmeId).then((etapes) => {
      const seen = new Set<number>();
      const opts: { id: number; libelle: string }[] = [];
      for (const e of etapes) {
        if (!seen.has(e.plv_id)) {
          seen.add(e.plv_id);
          opts.push({ id: e.plv_id, libelle: e.plv_libelle });
        }
      }
      setPlvOptions(opts);
    });
  }, [programmeId]);

  async function handleSave(): Promise<void> {
    if (!description.trim()) {
      Alert.alert('Description manquante', 'Decris brievement l\'anomalie.');
      return;
    }
    setSaving(true);
    try {
      const anomalieUuid = await creerAnomalie({
        programme_uuid: programmeUuid,
        plv_id: selectedPlvId,
        type_anomalie: typeAnomalie,
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
        <View style={styles.gpsRow}>
          <View style={[styles.gpsDot, {
            backgroundColor:
              gpsStatus === 'fiable'       ? '#34d399' :
              gpsStatus === 'degradee'     ? '#fbbf24' :
              gpsStatus === 'indisponible' ? '#f87171' : '#94a3b8',
          }]} />
          <Text style={styles.gpsStatus}>
            {gpsStatus === 'fiable'       ? 'GPS fiable' :
             gpsStatus === 'degradee'     ? 'GPS imprecis' :
             gpsStatus === 'indisponible' ? 'GPS absent' : 'GPS en cours...'}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Type d'anomalie</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={typeAnomalie} onValueChange={(v) => setTypeAnomalie(v)}>
          {TYPES_ANOMALIE.map((t) => (
            <Picker.Item key={t} label={t} value={t} />
          ))}
        </Picker>
      </View>

      {plvOptions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>PLV concernee (optionnel)</Text>
          <View style={styles.pickerWrap}>
            <Picker
              selectedValue={selectedPlvId}
              onValueChange={(v) => setSelectedPlvId(v)}
            >
              <Picker.Item label="-- Aucune PLV specifique --" value={null} />
              {plvOptions.map((p) => (
                <Picker.Item key={p.id} label={p.libelle} value={p.id} />
              ))}
            </Picker>
          </View>
        </>
      )}

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
  header: { backgroundColor: '#f47920', padding: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsStatus: { color: '#fde8d0', fontSize: 12 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: '#333',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  pickerWrap: {
    backgroundColor: '#fff', marginHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#ccc',
  },
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
