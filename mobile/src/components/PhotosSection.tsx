/**
 * Section de gestion des photos (capture camera / galerie + miniatures).
 * Les types de photo sont configurables via la prop `types`
 * (defaut : types d'operation ; pour une anomalie on passe le type ANOMALIE).
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { prendrePhoto, choisirPhoto, PhotoCapturee } from '../services/photoService';

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
}

const DEFAULT_TYPES: TypeOption[] = [
  { label: 'Bordereau', value: 'BORDEREAU' },
  { label: 'Livraison', value: 'LIVRAISON' },
  { label: 'Etat PLV', value: 'ETAT_PLV' },
];

export default function PhotosSection({ photos, onChange, types = DEFAULT_TYPES }: Props): React.ReactElement {
  const [busy, setBusy] = useState<boolean>(false);
  const [typeChoisi, setTypeChoisi] = useState<string>(types[0].value);

  async function ajouter(capture: () => Promise<PhotoCapturee | null>): Promise<void> {
    setBusy(true);
    try {
      const photo = await capture();
      if (photo) {
        onChange([...photos, { uri: photo.uri, tailleOctets: photo.tailleOctets, type_photo: typeChoisi }]);
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
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
        <TouchableOpacity style={styles.actionButton} onPress={() => ajouter(choisirPhoto)} disabled={busy}>
          <Text style={styles.actionText}>Galerie</Text>
        </TouchableOpacity>
      </View>

      {busy && <ActivityIndicator color="#0d6efd" style={{ marginVertical: 8 }} />}

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', marginHorizontal: 12, padding: 14, borderRadius: 10 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e9ecef' },
  typeChipActive: { backgroundColor: '#0d6efd' },
  typeChipText: { fontSize: 12, color: '#333', fontWeight: '600' },
  typeChipTextActive: { color: '#fff' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#6c757d', alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  thumbs: { marginTop: 12 },
  thumbWrap: { marginRight: 10, alignItems: 'center' },
  thumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#eee' },
  thumbRemove: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: '#dc3545', width: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center',
  },
  thumbRemoveText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  thumbType: { fontSize: 10, color: '#888', marginTop: 2 },
});
