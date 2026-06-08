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

const TYPES_ANOMALIE: { value: string; label: string; icon: string }[] = [
  { value: 'PLV ferme',         label: 'PLV fermée',        icon: '▣' },
  { value: 'Client absent',     label: 'Client absent',     icon: '○' },
  { value: 'Refus de paiement', label: 'Refus paiement',    icon: '$' },
  { value: 'Produit endommage', label: 'Produit endommagé', icon: '!' },
  { value: 'Acces impossible',  label: 'Accès impossible',  icon: '⊘' },
  { value: 'Autre',             label: 'Autre',             icon: '···' },
];

export default function AnomalieScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeUuid, programmeId } = route.params;

  const [typeAnomalie, setTypeAnomalie] = useState<string>(TYPES_ANOMALIE[0].value);
  const [description, setDescription]   = useState<string>('');
  const [photos, setPhotos]             = useState<PhotoEnAttente[]>([]);
  const [gpsLat, setGpsLat]             = useState<number | null>(null);
  const [gpsLon, setGpsLon]             = useState<number | null>(null);
  const [gpsStatus, setGpsStatus]       = useState<'en cours' | 'fiable' | 'degradee' | 'indisponible'>('en cours');
  const [saving, setSaving]             = useState<boolean>(false);
  const [plvOptions, setPlvOptions]     = useState<{ id: number; libelle: string }[]>([]);
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
      Alert.alert('Description manquante', "Décris brièvement l'anomalie rencontrée.");
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
        'Anomalie signalée',
        "L'anomalie est enregistrée localement. Elle sera remontée à la prochaine synchronisation.",
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }}>

      {/* ══ HEADER ══ */}
      <View style={styles.header}>
        {/* Cercles décoratifs */}
        <View style={styles.bgCircle1} pointerEvents="none" />
        <View style={styles.bgCircle2} pointerEvents="none" />

        <View style={styles.headerContent}>
          {/* GPS en haut à droite */}
          <View style={styles.headerTopBar}>
            <View style={styles.headerIconWrap}>
              <Text style={styles.headerIcon}>⚠</Text>
            </View>
            <View style={[styles.gpsPill, {
              backgroundColor:
                gpsStatus === 'fiable'       ? 'rgba(52,211,153,0.18)' :
                gpsStatus === 'degradee'     ? 'rgba(251,191,36,0.18)' :
                gpsStatus === 'indisponible' ? 'rgba(248,113,113,0.18)' :
                                              'rgba(148,163,184,0.18)',
            }]}>
              <View style={[styles.gpsDot, {
                backgroundColor:
                  gpsStatus === 'fiable'       ? '#34d399' :
                  gpsStatus === 'degradee'     ? '#fbbf24' :
                  gpsStatus === 'indisponible' ? '#f87171' : '#94a3b8',
              }]} />
              <Text style={styles.gpsPillText}>
                {gpsStatus === 'fiable'       ? 'GPS fiable' :
                 gpsStatus === 'degradee'     ? 'GPS imprécis' :
                 gpsStatus === 'indisponible' ? 'GPS absent' : 'GPS…'}
              </Text>
            </View>
          </View>

          <Text style={styles.headerTitle}>Signaler une anomalie</Text>
          <Text style={styles.headerSub}>
            Enregistrement local · remontée à la prochaine sync
          </Text>
        </View>
      </View>

      {/* ══ TYPE D'ANOMALIE ══ */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, styles.sectionIconRed]}>
          <Text style={styles.sectionIconText}>≡</Text>
        </View>
        <Text style={styles.sectionTitle}>Type d'anomalie</Text>
      </View>
      <View style={styles.typeGrid}>
        {TYPES_ANOMALIE.map((t) => {
          const selected = typeAnomalie === t.value;
          return (
            <TouchableOpacity
              key={t.value}
              style={[styles.typeChip, selected && styles.typeChipSelected]}
              onPress={() => setTypeAnomalie(t.value)}
              activeOpacity={0.75}
            >
              <Text style={[styles.typeChipIcon, selected && styles.typeChipIconSelected]}>
                {t.icon}
              </Text>
              <Text style={[styles.typeChipLabel, selected && styles.typeChipLabelSelected]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ══ PLV CONCERNÉE ══ */}
      {plvOptions.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconBox, styles.sectionIconOrange]}>
              <Text style={styles.sectionIconText}>◎</Text>
            </View>
            <Text style={styles.sectionTitle}>PLV concernée</Text>
            <Text style={styles.sectionOptional}>(optionnel)</Text>
          </View>
          <View style={styles.sectionCard}>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={selectedPlvId}
                onValueChange={(v) => setSelectedPlvId(v)}
              >
                <Picker.Item label="— Aucune PLV spécifique —" value={null} />
                {plvOptions.map((p) => (
                  <Picker.Item key={p.id} label={p.libelle} value={p.id} />
                ))}
              </Picker>
            </View>
          </View>
        </>
      )}

      {/* ══ DESCRIPTION ══ */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, styles.sectionIconNavy]}>
          <Text style={styles.sectionIconText}>✎</Text>
        </View>
        <Text style={styles.sectionTitle}>Description</Text>
        <Text style={styles.charCount}>{description.length} car.</Text>
      </View>
      <View style={styles.sectionCard}>
        <TextInput
          style={styles.description}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="Décris l'anomalie rencontrée : cause, contexte, actions déjà tentées…"
          placeholderTextColor="#94a3b8"
          textAlignVertical="top"
        />
      </View>

      {/* ══ PHOTOS ══ */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, styles.sectionIconBlue]}>
          <Text style={styles.sectionIconText}>▣</Text>
        </View>
        <Text style={styles.sectionTitle}>Photo</Text>
        <Text style={styles.sectionOptional}>(optionnel)</Text>
      </View>
      <View style={styles.sectionCardNoPad}>
        <PhotosSection
          photos={photos}
          onChange={setPhotos}
          types={[{ label: 'Anomalie', value: 'ANOMALIE' }]}
          cameraOnly
        />
      </View>

      {/* ══ NOTE INFO ══ */}
      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>ℹ</Text>
        <Text style={styles.infoText}>
          La gravité sera évaluée et ajustée par votre superviseur après réception.
        </Text>
      </View>

      {/* ══ BOUTON ENREGISTRER ══ */}
      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Text style={styles.saveText}>Enregistrer l'anomalie</Text>
            <Text style={styles.saveSub}>
              {TYPES_ANOMALIE.find((t) => t.value === typeAnomalie)?.label ?? typeAnomalie}
            </Text>
          </>
        )}
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f4f8' },

  // ── Header rouge
  header: { backgroundColor: '#991b1b', overflow: 'hidden', marginBottom: 4 },
  bgCircle1: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(220,53,69,0.3)', top: -70, right: -55, zIndex: 0,
  },
  bgCircle2: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(220,53,69,0.18)', top: 40, right: 95, zIndex: 0,
  },
  headerContent: { padding: 16, paddingBottom: 22, zIndex: 1 },

  headerTopBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  headerIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  headerIcon: { fontSize: 20, color: '#fff' },

  gpsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  gpsDot: { width: 7, height: 7, borderRadius: 4 },
  gpsPillText: { fontSize: 12, fontWeight: '600', color: '#fde8e8' },

  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 },

  // ── En-têtes de section
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginHorizontal: 14, marginTop: 20, marginBottom: 8,
  },
  sectionIconBox: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionIconRed:    { backgroundColor: 'rgba(220,53,69,0.12)' },
  sectionIconOrange: { backgroundColor: 'rgba(244,121,32,0.12)' },
  sectionIconNavy:   { backgroundColor: 'rgba(10,22,40,0.1)' },
  sectionIconBlue:   { backgroundColor: 'rgba(26,127,186,0.12)' },
  sectionIconText:   { fontSize: 15, fontWeight: '800', color: '#0a1628' },
  sectionTitle:    { fontSize: 14, fontWeight: '800', color: '#0a1628', letterSpacing: -0.2 },
  sectionOptional: { fontSize: 12, color: '#94a3b8', marginLeft: 2 },
  charCount:       { fontSize: 12, color: '#94a3b8', marginLeft: 'auto' },

  // Cards de section
  sectionCard: {
    backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 14, padding: 14,
    shadowColor: '#0a1628', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  sectionCardNoPad: {
    backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 14, overflow: 'hidden',
    shadowColor: '#0a1628', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },

  // ── Grille de types
  typeGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginHorizontal: 12, gap: 8,
  },
  typeChip: {
    width: '47.5%', paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 12, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#e2e8f0',
    alignItems: 'center', gap: 6,
    shadowColor: '#0a1628', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  typeChipSelected: {
    backgroundColor: 'rgba(220,53,69,0.06)',
    borderColor: '#dc3545',
  },
  typeChipIcon: { fontSize: 20, color: '#94a3b8' },
  typeChipIconSelected: { color: '#dc3545' },
  typeChipLabel: {
    fontSize: 12, fontWeight: '700', color: '#6c757d', textAlign: 'center',
  },
  typeChipLabelSelected: { color: '#dc3545' },

  // Picker PLV
  pickerWrap: {
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10,
    overflow: 'hidden', backgroundColor: '#fafbfc',
  },

  // Description
  description: {
    minHeight: 100, fontSize: 14, color: '#0a1628',
    lineHeight: 21,
  },

  // Note info
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: 14, marginTop: 18,
    backgroundColor: '#f8fafc',
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  infoIcon: { fontSize: 16, color: '#94a3b8', lineHeight: 20 },
  infoText: { flex: 1, fontSize: 12, color: '#6c757d', lineHeight: 18 },

  // ── Bouton enregistrer
  saveButton: {
    backgroundColor: '#dc3545', marginHorizontal: 12, marginTop: 20, marginBottom: 8,
    paddingVertical: 16, paddingHorizontal: 20, borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#dc3545', shadowOpacity: 0.28, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  saveSub:  { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 },
});
