/**
 * Ecran de signalement d'une anomalie sur un programme.
 * Type + description + photo(s) optionnelle(s) + géolocalisation.
 * La gravité est fixée à MOYENNE par défaut ; le superviseur la reclassifie.
 * Enregistrement local PENDING (offline-first), remonte à la sync.
 * Design néomorphisme sombre.
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
import { Colors } from '../theme';

// ── Palette néomorphisme ─────────────────────────────────────────────────────
const BASE    = '#0d1e35';
const SURFACE = '#112240';
const DEEPER  = '#07111e';
const LIFT    = 'rgba(255,255,255,0.06)';
const INSET   = '#091527';
const INSET_SHADOW = 'rgba(0,0,0,0.5)';
const INSET_LIGHT  = 'rgba(255,255,255,0.04)';

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
  const [description, setDescription]   = useState('');
  const [photos, setPhotos]             = useState<PhotoEnAttente[]>([]);
  const [gpsLat, setGpsLat]             = useState<number | null>(null);
  const [gpsLon, setGpsLon]             = useState<number | null>(null);
  const [gpsStatus, setGpsStatus]       = useState<'en cours' | 'fiable' | 'degradee' | 'indisponible'>('en cours');
  const [saving, setSaving]             = useState(false);
  const [plvOptions, setPlvOptions]     = useState<{ id: number; libelle: string }[]>([]);
  const [selectedPlvId, setSelectedPlvId] = useState<number | null>(null);
  const [descFocused, setDescFocused]   = useState(false);

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

  const gpsColor = gpsStatus === 'fiable' ? '#34d399' : gpsStatus === 'degradee' ? '#fbbf24' : gpsStatus === 'indisponible' ? '#f87171' : '#94a3b8';
  const gpsBg    = gpsStatus === 'fiable' ? 'rgba(52,211,153,0.14)' : gpsStatus === 'degradee' ? 'rgba(251,191,36,0.14)' : gpsStatus === 'indisponible' ? 'rgba(248,113,113,0.14)' : 'rgba(148,163,184,0.14)';
  const gpsLabel = gpsStatus === 'fiable' ? 'GPS fiable' : gpsStatus === 'degradee' ? 'GPS imprécis' : gpsStatus === 'indisponible' ? 'GPS absent' : 'GPS…';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* ══ HEADER ══ */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <View style={styles.headerTopBar}>
            {/* Icône ⚠ néomorphe */}
            <View style={styles.warnIconOuter}>
              <View style={styles.warnIconBox}>
                <Text style={styles.warnIconText}>⚠</Text>
              </View>
            </View>
            {/* GPS pill */}
            <View style={styles.gpsPillOuter}>
              <View style={[styles.gpsPill, { backgroundColor: gpsBg }]}>
                <View style={[styles.gpsDot, { backgroundColor: gpsColor }]} />
                <Text style={[styles.gpsPillText, { color: gpsColor }]}>{gpsLabel}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.headerTitle}>Signaler une anomalie</Text>
          <Text style={styles.headerSub}>Enregistrement local · remontée à la prochaine sync</Text>
        </View>
      </View>

      {/* ══ TYPE D'ANOMALIE ══ */}
      <SectionHeader icon="≡" color="red" title="Type d'anomalie" />
      <View style={styles.typeGrid}>
        {TYPES_ANOMALIE.map((t) => {
          const selected = typeAnomalie === t.value;
          return (
            <View key={t.value} style={[styles.typeChipOuter, selected && styles.typeChipOuterSelected]}>
              <TouchableOpacity
                style={[styles.typeChip, selected && styles.typeChipSelected]}
                onPress={() => setTypeAnomalie(t.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.typeChipIcon, selected && styles.typeChipIconSelected]}>
                  {t.icon}
                </Text>
                <Text style={[styles.typeChipLabel, selected && styles.typeChipLabelSelected]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* ══ PLV CONCERNÉE ══ */}
      {plvOptions.length > 0 && (
        <>
          <SectionHeader icon="◎" color="orange" title="PLV concernée" optional />
          <View style={styles.cardOuter}>
            <View style={styles.card}>
              <View style={styles.pickerWrap}>
                <Picker
                  selectedValue={selectedPlvId}
                  onValueChange={(v) => setSelectedPlvId(v)}
                  dropdownIconColor="rgba(255,255,255,0.4)"
                  style={{ color: '#fff' }}
                  itemStyle={{ color: '#fff', backgroundColor: BASE }}
                >
                  <Picker.Item label="— Aucune PLV spécifique —" value={null} />
                  {plvOptions.map((p) => (
                    <Picker.Item key={p.id} label={p.libelle} value={p.id} />
                  ))}
                </Picker>
              </View>
            </View>
          </View>
        </>
      )}

      {/* ══ DESCRIPTION ══ */}
      <View style={styles.sectionHeaderRow}>
        <SectionHeader icon="✎" color="navy" title="Description" />
        <Text style={styles.charCount}>{description.length} car.</Text>
      </View>
      <View style={styles.cardOuter}>
        <View style={styles.card}>
          <View style={[styles.descWrap, descFocused && styles.descWrapFocused]}>
            <TextInput
              style={styles.description}
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="Décris l'anomalie rencontrée : cause, contexte, actions déjà tentées…"
              placeholderTextColor="rgba(255,255,255,0.2)"
              textAlignVertical="top"
              onFocus={() => setDescFocused(true)}
              onBlur={() => setDescFocused(false)}
            />
          </View>
        </View>
      </View>

      {/* ══ PHOTOS ══ */}
      <SectionHeader icon="▣" color="blue" title="Photo" optional />
      <View style={styles.cardOuter}>
        <View style={styles.cardNoPad}>
          <PhotosSection
            photos={photos}
            onChange={setPhotos}
            types={[{ label: 'Anomalie', value: 'ANOMALIE' }]}
            cameraOnly
          />
        </View>
      </View>

      {/* ══ NOTE INFO ══ */}
      <View style={styles.infoOuter}>
        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ</Text>
          <Text style={styles.infoText}>
            La gravité sera évaluée et ajustée par votre superviseur après réception.
          </Text>
        </View>
      </View>

      {/* ══ BOUTON ENREGISTRER ══ */}
      <View style={styles.saveBtnOuter}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <View style={styles.saveBtnSheen} pointerEvents="none" />
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.saveBtnText}>Enregistrer l'anomalie</Text>
              <Text style={styles.saveBtnSub}>
                {TYPES_ANOMALIE.find((t) => t.value === typeAnomalie)?.label ?? typeAnomalie}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

type IconColor = 'blue' | 'green' | 'red' | 'orange' | 'navy' | 'gray';
function SectionHeader({ icon, color, title, optional }: { icon: string; color: IconColor; title: string; optional?: boolean }) {
  const bg: Record<IconColor, string> = { blue: 'rgba(7,155,217,0.15)', green: 'rgba(52,211,153,0.15)', red: 'rgba(248,113,113,0.15)', orange: 'rgba(238,114,2,0.15)', navy: 'rgba(255,255,255,0.08)', gray: 'rgba(148,163,184,0.12)' };
  const fg: Record<IconColor, string> = { blue: Colors.brandBlue, green: '#34d399', red: '#f87171', orange: Colors.brandOrange, navy: 'rgba(255,255,255,0.7)', gray: '#94a3b8' };
  return (
    <View style={sh.row}>
      <View style={sh.iconOuter}>
        <View style={[sh.iconBox, { backgroundColor: bg[color] }]}>
          <Text style={[sh.iconText, { color: fg[color] }]}>{icon}</Text>
        </View>
      </View>
      <Text style={sh.title}>{title}</Text>
      {optional && <Text style={sh.optional}>(optionnel)</Text>}
    </View>
  );
}
const sh = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 22, marginBottom: 8 },
  iconOuter:{ borderRadius: 10, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 5, elevation: 4 },
  iconBox:  { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  iconText: { fontSize: 14, fontWeight: '800' },
  title:    { fontSize: 14, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: -0.2 },
  optional: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 2 },
});

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BASE },
  scroll: { paddingBottom: 48 },

  // Header
  header: { backgroundColor: BASE, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -70, right: -55, backgroundColor: 'rgba(248,113,113,0.07)' },
  bubble2: { position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 40, right: 105, backgroundColor: 'rgba(248,113,113,0.04)' },
  headerContent: { padding: 16, paddingBottom: 22 },
  headerTopBar:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

  warnIconOuter: { borderRadius: 14, shadowColor: 'rgba(220,38,38,0.6)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 5 },
  warnIconBox:   { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(248,113,113,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
  warnIconText:  { fontSize: 22, color: '#f87171' },

  gpsPillOuter: { borderRadius: 20, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 4 },
  gpsPill:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  gpsDot:   { width: 7, height: 7, borderRadius: 4 },
  gpsPillText: { fontSize: 12, fontWeight: '700' },

  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 },

  // Type grid
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 12, gap: 8, marginBottom: 4 },
  typeChipOuter: { width: '47.5%', borderRadius: 14, shadowColor: DEEPER, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.85, shadowRadius: 8, elevation: 5 },
  typeChipOuterSelected: { shadowColor: 'rgba(248,113,113,0.4)', shadowOpacity: 0.6 },
  typeChip: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', gap: 6, backgroundColor: SURFACE, borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  typeChipSelected: { backgroundColor: 'rgba(248,113,113,0.1)', borderTopColor: 'rgba(248,113,113,0.3)', borderLeftColor: 'rgba(248,113,113,0.3)', borderBottomColor: 'rgba(248,113,113,0.15)', borderRightColor: 'rgba(248,113,113,0.15)' },
  typeChipIcon: { fontSize: 20, color: 'rgba(255,255,255,0.25)' },
  typeChipIconSelected: { color: '#f87171' },
  typeChipLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
  typeChipLabelSelected: { color: '#f87171' },

  // Section header wrapper (pour aligner le compteur de caractères)
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 14 },
  charCount: { fontSize: 12, color: 'rgba(255,255,255,0.25)' },

  // Cards
  cardOuter: { marginHorizontal: 12, marginBottom: 4, borderRadius: 16, shadowColor: DEEPER, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.85, shadowRadius: 12, elevation: 6 },
  card: { backgroundColor: SURFACE, borderRadius: 16, padding: 14, borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  cardNoPad: { backgroundColor: SURFACE, borderRadius: 16, overflow: 'hidden', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },

  // Picker
  pickerWrap: { borderRadius: 12, overflow: 'hidden', backgroundColor: INSET, borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: INSET_SHADOW, borderLeftColor: INSET_SHADOW, borderBottomColor: INSET_LIGHT, borderRightColor: INSET_LIGHT },

  // Description
  descWrap: { backgroundColor: INSET, borderRadius: 12, overflow: 'hidden', borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: INSET_SHADOW, borderLeftColor: INSET_SHADOW, borderBottomColor: INSET_LIGHT, borderRightColor: INSET_LIGHT },
  descWrapFocused: { borderTopColor: Colors.brandBlue, borderLeftColor: Colors.brandBlue, borderBottomColor: Colors.brandBlue, borderRightColor: Colors.brandBlue },
  description: { minHeight: 100, padding: 12, fontSize: 14, color: '#fff', lineHeight: 21 },

  // Info
  infoOuter: { marginHorizontal: 12, marginTop: 16, marginBottom: 4, borderRadius: 12, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.7, shadowRadius: 6, elevation: 3 },
  infoBox:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: SURFACE, borderRadius: 12, padding: 12, borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  infoIcon: { fontSize: 15, color: 'rgba(255,255,255,0.25)' },
  infoText: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 18 },

  // Bouton enregistrer
  saveBtnOuter: { marginHorizontal: 12, marginTop: 20, marginBottom: 8, borderRadius: 14, shadowColor: '#991b1b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.55, shadowRadius: 14, elevation: 10 },
  saveBtn: { backgroundColor: '#dc2626', borderRadius: 14, paddingVertical: 17, paddingHorizontal: 20, alignItems: 'center', overflow: 'hidden' },
  saveBtnSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.1)', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  saveBtnSub:  { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 4 },
});
