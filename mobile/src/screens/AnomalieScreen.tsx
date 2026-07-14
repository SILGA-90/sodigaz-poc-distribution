/**
 * Écran de signalement d'anomalie terrain.
 *
 * Permet au livreur de signaler une anomalie observée pendant la
 * tournée : fuite de gaz, dommage matériel, absence de responsable,
 * problème d'accès, autre. L'anomalie est rattachée à un programme
 * et éventuellement à un PLV spécifique. Une photo peut être jointe.
 *
 * Le livreur n'est pas
 * formé pour évaluer la gravité technique d'une anomalie. Le superviseur
 * reclassifie après examen. Voir anomalieRepository.creerAnomalie().
 *
 * La position GPS permet de
 * localiser l'anomalie sur la carte de supervision. Si le GPS est
 * indisponible, l'anomalie est enregistrée sans coordonnées : non
 * bloquant (le livreur ne doit pas être bloqué par un GPS lent).
 *
 * PhotosSection est configurée avec
 * un type unique ANOMALIE : pas de sélecteur de type affiché.
 * La galerie est autorisée (cameraOnly=false) : une anomalie peut
 * être photographiée avec la galerie si la caméra a déjà capturé
 * une image pertinente.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NeoSelect from '../components/NeoSelect';
import NeoDialog from '../components/NeoDialog';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { creerAnomalie } from '../db/repositories/anomalieRepository';
import { getEtapesDuProgramme } from '../db/repositories/programmeRepository';
import { ajouterPhotoAnomalie } from '../db/repositories/photoRepository';
import { acquerirPositionProbante } from '../services/locationService';
import PhotosSection, { PhotoEnAttente } from '../components/PhotosSection';
import { RootStackParamList } from '../types/navigation';
import { Colors, scale } from '../theme';
import SectionHeader from '../components/saisie/SectionHeader';
import { NEO, NEO_IN, NAVY, TEXT, TEXT2, TEXT3, neoCard } from '../components/saisie/neoStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'Anomalie'>;

const TYPES_ANOMALIE: { value: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'PLV ferme',         label: 'PLV fermée',        icon: 'lock-closed-outline'    },
  { value: 'Client absent',     label: 'Client absent',     icon: 'person-outline'          },
  { value: 'Refus de paiement', label: 'Refus paiement',    icon: 'card-outline'            },
  { value: 'Produit endommage', label: 'Produit endommagé', icon: 'warning-outline'         },
  { value: 'Acces impossible',  label: 'Accès impossible',  icon: 'ban-outline'             },
  { value: 'Autre',             label: 'Autre',             icon: 'help-circle-outline'     },
];

export default function AnomalieScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeUuid, programmeId } = route.params;
  const { width } = useWindowDimensions();

  const [typeAnomalie, setTypeAnomalie]   = useState<string>(TYPES_ANOMALIE[0].value);
  const [description, setDescription]     = useState('');
  const [photos, setPhotos]               = useState<PhotoEnAttente[]>([]);
  const [gpsLat, setGpsLat]               = useState<number | null>(null);
  const [gpsLon, setGpsLon]               = useState<number | null>(null);
  const [gpsStatus, setGpsStatus]         = useState<'en cours' | 'fiable' | 'degradee' | 'indisponible'>('en cours');
  const [saving, setSaving]               = useState(false);
  const [plvOptions, setPlvOptions]       = useState<{ id: number; libelle: string }[]>([]);
  const [selectedPlvId, setSelectedPlvId] = useState<number | null>(null);
  const [descFocused, setDescFocused]     = useState(false);
  const [showDescAlert, setShowDescAlert] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog]     = useState(false);
  const [saveErrorMsg, setSaveErrorMsg]           = useState('');

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
          const label = e.plv_code ? `${e.plv_code} · ${e.client_raison_sociale}` : e.client_raison_sociale;
          opts.push({ id: e.plv_id, libelle: label });
        }
      }
      setPlvOptions(opts);
    });
  }, [programmeId]);

  async function handleSave(): Promise<void> {
    if (!description.trim()) {
      setShowDescAlert(true);
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
      setShowSuccessDialog(true);
    } catch {
      setSaveErrorMsg("Erreur lors de l'enregistrement. Réessaie ou contacte ton superviseur.");
      setShowErrorDialog(true);
    } finally {
      setSaving(false);
    }
  }

  const gpsColor = gpsStatus === 'fiable' ? Colors.success : gpsStatus === 'degradee' ? Colors.warning : gpsStatus === 'indisponible' ? Colors.danger : TEXT3;
  const gpsBg    = gpsStatus === 'fiable' ? Colors.successBg : gpsStatus === 'degradee' ? Colors.warningBg : gpsStatus === 'indisponible' ? Colors.dangerBg : NEO_IN;
  const gpsLabel = gpsStatus === 'fiable' ? 'GPS fiable' : gpsStatus === 'degradee' ? 'GPS imprécis' : gpsStatus === 'indisponible' ? 'GPS absent' : 'GPS...';

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, width >= 700 && styles.wideContent]}>

      {/* Header navy (bulles danger) */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <View style={styles.headerTopBar}>
            {/* Icône danger raised */}
            <View style={styles.warnBox}>
              <Ionicons name="warning" size={22} color={Colors.danger} />
            </View>
            {/* GPS pill */}
            <View style={[styles.gpsPill, { backgroundColor: gpsBg, borderColor: gpsColor + '40' }]}>
              <View style={[styles.gpsDot, { backgroundColor: gpsColor }]} />
              <Text style={[styles.gpsPillText, { color: gpsColor }]}>{gpsLabel}</Text>
            </View>
          </View>
          <Text style={styles.headerTitle}>Signaler une anomalie</Text>
          <Text style={styles.headerSub}>Enregistrement local · remontée à la prochaine sync</Text>
        </View>
      </View>

      {/* TYPE D'ANOMALIE */}
      <SectionHeader icon="list-outline" color="red" title="Type d'anomalie" />
      <View style={neoCard.outer}>
        <View style={neoCard.inner}>
          <NeoSelect
            value={typeAnomalie}
            onChange={(v) => setTypeAnomalie(v as string)}
            options={TYPES_ANOMALIE.map((t) => ({ label: t.label, value: t.value }))}
          />
        </View>
      </View>

      {/* PLV CONCERNÉE */}
      {plvOptions.length > 0 && (
        <>
          <SectionHeader icon="location-outline" color="orange" title="PLV concernée" optional />
          <View style={neoCard.outer}>
            <View style={neoCard.inner}>
              <NeoSelect
                value={selectedPlvId}
                onChange={(v) => setSelectedPlvId(v as number | null)}
                placeholder=": Aucune PLV spécifique :"
                options={[
                  { label: ': Aucune PLV spécifique :', value: null },
                  ...plvOptions.map((p) => ({ label: p.libelle, value: p.id })),
                ]}
              />
            </View>
          </View>
        </>
      )}

      {/* DESCRIPTION */}
      <View style={styles.sectionHeaderRow}>
        <SectionHeader icon="create-outline" color="navy" title="Description" />
        <Text style={styles.charCount}>{description.length} car.</Text>
      </View>
      <View style={neoCard.outer}>
        <View style={neoCard.inner}>
          <TextInput
            style={[styles.descInput, descFocused && styles.descInputFocused]}
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="Décris l'anomalie rencontrée : cause, contexte, actions déjà tentées..."
            placeholderTextColor="#8fa4b4"
            textAlignVertical="top"
            onFocus={() => setDescFocused(true)}
            onBlur={() => setDescFocused(false)}
          />
        </View>
      </View>

      {/* PHOTOS */}
      <SectionHeader icon="camera-outline" color="blue" title="Photo" optional />
      <View style={neoCard.outer}>
        <View style={neoCard.innerOverflow}>
          <PhotosSection
            photos={photos}
            onChange={setPhotos}
            types={[{ label: 'Anomalie', value: 'ANOMALIE' }]}
            cameraOnly
          />
        </View>
      </View>

      {/* NOTE INFO */}
      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.brandBlue} />
        <Text style={styles.infoText}>La gravité sera évaluée et ajustée par votre superviseur après réception.</Text>
      </View>

      {/* ENREGISTRER */}
      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
        {saving ? <ActivityIndicator color="#fff" /> : (
          <>
            <Text style={styles.saveBtnText}>Enregistrer l'anomalie</Text>
            <Text style={styles.saveBtnSub}>{TYPES_ANOMALIE.find((t) => t.value === typeAnomalie)?.label ?? typeAnomalie}</Text>
          </>
        )}
      </TouchableOpacity>

      <NeoDialog
        visible={showDescAlert}
        icon="create-outline" iconColor={Colors.brandBlue}
        title="Description manquante"
        message="Décris brièvement l'anomalie rencontrée avant d'enregistrer."
        singleButton confirmLabel="OK"
        onConfirm={() => setShowDescAlert(false)}
        onCancel={() => setShowDescAlert(false)}
      />
      <NeoDialog
        visible={showSuccessDialog}
        icon="checkmark-circle-outline" iconColor={Colors.success}
        title="Anomalie signalée"
        message="L'anomalie est enregistrée localement. Elle sera remontée à la prochaine synchronisation."
        singleButton confirmLabel="OK"
        onConfirm={() => { setShowSuccessDialog(false); navigation.goBack(); }}
        onCancel={() => {}}
      />
      <NeoDialog
        visible={showErrorDialog}
        icon="alert-circle-outline" iconColor={Colors.danger}
        title="Erreur"
        message={saveErrorMsg}
        singleButton confirmLabel="OK"
        onConfirm={() => setShowErrorDialog(false)}
        onCancel={() => setShowErrorDialog(false)}
      />
    </ScrollView>
  );
}

/* Styles */
const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: NEO },
  scroll:      { paddingBottom: 48 },
  wideContent: { maxWidth: 700, alignSelf: 'center', width: '100%' },

  /* Header navy : bulles danger */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -70, right: -55, backgroundColor: 'rgba(220,38,38,0.1)' },
  bubble2: { position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 40,  right: 105, backgroundColor: 'rgba(220,38,38,0.07)' },
  headerContent: { padding: 16, paddingBottom: 22 },
  headerTopBar:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

  warnBox: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.dangerBg, borderWidth: 1, borderColor: Colors.dangerBorder,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.danger, shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  gpsPill:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  gpsDot:      { width: 7, height: 7, borderRadius: 4 },
  gpsPillText: { fontSize: scale(12), fontWeight: '700' },

  headerTitle: { fontSize: scale(20), fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  headerSub:   { fontSize: scale(12), color: 'rgba(255,255,255,0.45)', marginTop: 4 },


  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 14 },
  charCount: { fontSize: scale(12), color: TEXT3 },

  /* Description */
  descInput: {
    minHeight: 100, padding: 12, fontSize: scale(14), color: TEXT, lineHeight: 21,
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1.5, borderColor: '#DDE2E6',
  },
  descInputFocused: {
    borderColor: Colors.brandBlue,
    backgroundColor: Colors.primaryLight,
  },

  /* Info box */
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: 12, marginTop: 16, marginBottom: 4,
    borderRadius: 12, backgroundColor: Colors.infoBg, padding: 12,
    borderWidth: 1, borderColor: Colors.infoBorder,
  },
  infoText: { flex: 1, fontSize: scale(12), color: TEXT2, lineHeight: 18 },

  /* Bouton danger */
  saveBtn: {
    marginHorizontal: 12, marginTop: 20, marginBottom: 8,
    borderRadius: 14, backgroundColor: Colors.danger,
    paddingVertical: 17, paddingHorizontal: 20, alignItems: 'center',
    shadowColor: '#991b1b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  saveBtnText: { color: '#fff', fontSize: scale(16), fontWeight: '800', letterSpacing: -0.2 },
  saveBtnSub:  { color: 'rgba(255,255,255,0.65)', fontSize: scale(12), marginTop: 4 },
});
