/**
 * Section de gestion des photos terrain (capture + miniatures).
 *
 * Ce composant composable gère le sous-formulaire photo dans
 * SaisieOperationScreen et AnomalieScreen. Il expose :
 *          - Un sélecteur de type de photo (chips : Bordereau / Livraison / Etat PLV)
 *          - Un bouton "Prendre une photo" (caméra)
 *          - Un bouton "Galerie" (optionnel, désactivable via cameraOnly)
 *          - Une bande de miniatures horizontales avec bouton de suppression
 *
 * Les photos sont retournées via onChange comme tableau de PhotoEnAttente
 * (uri local + taille + type). L'insert en base et l'upload sont gérés
 * par l'écran parent après validation du formulaire.
 *
 * *        Utiliser la galerie pour choisir une photo ancienne comme "preuve"
 * d'une livraison du jour serait une fraude. Pour les preuves de
 * livraison critiques (photo du client avec son gaz), on passe
 * cameraOnly=true pour forcer une prise de vue en temps réel.
 *
 * Le type de photo dépend du contexte :
 * - Opération : BORDEREAU / LIVRAISON / ETAT_PLV
 * - Anomalie  : ANOMALIE (type unique, pas de sélecteur affiché)
 * Configurer via la prop `types` évite deux composants distincts.
 *
 * Les photos sont tenues en
 * état local React jusqu'à la validation du formulaire. À ce moment,
 * l'écran parent appelle ajouterPhotoOperation() ou ajouterPhotoAnomalie()
 * pour les insérer en base SQLite avec sync_status = PENDING.
 * Cela évite de polluer la base avec des photos d'une opération annulée.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { prendrePhoto, choisirPhoto, PhotoCapturee } from '../services/photoService';
import { Colors, scale } from '../theme';
import NeoDialog from './NeoDialog';

export interface PhotoEnAttente {
  uri: string;
  tailleOctets: number;
  type_photo: string;
}

interface TypeOption {
  label: string;
  value: string;
}

interface Props {
  photos: PhotoEnAttente[];
  onChange: (photos: PhotoEnAttente[]) => void;
  types?: TypeOption[];
  /** Interdit la galerie : obligatoire pour les preuves de livraison (anti-fraude). */
  cameraOnly?: boolean;
}

const DEFAULT_TYPES: TypeOption[] = [
  { label: 'Bordereau', value: 'BORDEREAU' },
  { label: 'Livraison', value: 'LIVRAISON' },
  { label: 'Etat PLV', value: 'ETAT_PLV' },
];

export default function PhotosSection({ photos, onChange, types = DEFAULT_TYPES, cameraOnly = false }: Props): React.ReactElement {
  const [busy, setBusy]             = useState<boolean>(false);
  const [typeChoisi, setTypeChoisi] = useState<string>(types[0].value);
  const [showError, setShowError]   = useState(false);
  const [errorMsg, setErrorMsg]     = useState('');

  async function ajouter(capture: () => Promise<PhotoCapturee | null>): Promise<void> {
    setBusy(true);
    try {
      const photo = await capture();
      if (photo) {
        onChange([...photos, { uri: photo.uri, tailleOctets: photo.tailleOctets, type_photo: typeChoisi }]);
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setShowError(true);
    } finally {
      setBusy(false);
    }
  }

  function retirer(index: number): void {
    onChange(photos.filter((_, i) => i !== index));
  }

  return (
    <View style={styles.container}>
      {types.length > 1 && (
        <View style={styles.typeRow}>
          {types.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.typeChip, typeChoisi === t.value && styles.typeChipActive]}
              onPress={() => setTypeChoisi(t.value)}
            >
              <Text style={[styles.typeChipText, typeChoisi === t.value && styles.typeChipTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionButton} onPress={() => ajouter(prendrePhoto)} disabled={busy}>
          <Text style={styles.actionText}>Prendre une photo</Text>
        </TouchableOpacity>
        {!cameraOnly && (
          <TouchableOpacity style={styles.actionButton} onPress={() => ajouter(choisirPhoto)} disabled={busy}>
            <Text style={styles.actionText}>Galerie</Text>
          </TouchableOpacity>
        )}
      </View>

      {busy && <ActivityIndicator color={Colors.brandBlue} style={{ marginVertical: 8 }} />}

      {photos.length > 0 && (
        <ScrollView horizontal style={styles.thumbs} showsHorizontalScrollIndicator={false}>
          {photos.map((p, i) => (
            <View key={i} style={styles.thumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <TouchableOpacity style={styles.thumbRemove} onPress={() => retirer(i)}>
                <Text style={styles.thumbRemoveText}>X</Text>
              </TouchableOpacity>
              <Text style={styles.thumbType}>{p.type_photo}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <NeoDialog
        visible={showError}
        icon="warning-outline" iconColor={Colors.danger}
        title="Erreur photo"
        message={errorMsg}
        singleButton confirmLabel="OK"
        onConfirm={() => setShowError(false)}
        onCancel={() => setShowError(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#FFFFFF', marginHorizontal: 12, padding: 14, borderRadius: 10 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#E8EEF2' },
  typeChipActive: { backgroundColor: Colors.brandBlue },
  typeChipText: { fontSize: scale(12), color: '#3a5060', fontWeight: '600' },
  typeChipTextActive: { color: '#fff' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: Colors.brandBlue, alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: '600', fontSize: scale(13) },
  thumbs: { marginTop: 12 },
  thumbWrap: { marginRight: 10, alignItems: 'center' },
  thumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#E8EEF2' },
  thumbRemove: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: Colors.danger, width: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center',
  },
  thumbRemoveText: { color: '#fff', fontWeight: '700', fontSize: scale(11) },
  thumbType: { fontSize: scale(10), color: '#5B6770', marginTop: 2 },
});
