/**
 * Ecran de saisie d'une operation (collecte ou restitution) sur une etape.
 *
 * - RESTITUTION : produits prevus pre-remplis avec quantite prevue affichee.
 * - COLLECTE : tous les produits, quantites a 0 par defaut.
 * - Montant calcule auto (somme quantite x prix), corrigeable.
 * - Enregistrement local PENDING (offline-first).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import SignaturePad from '../components/SignaturePad';
import PhotosSection, { PhotoEnAttente } from '../components/PhotosSection';
import { ajouterPhotoOperation } from '../db/repositories/photoRepository';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapeInfo,
  getProduitsSaisissables,
  enregistrerOperation,
  ProduitSaisie,
  EtapeInfo,
} from '../db/repositories/saisieRepository';
import { ModePaiement } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'SaisieOperation'>;

interface LigneState {
  produit: ProduitSaisie;
  quantite: string; // string pour le TextInput
}

const MODES_PAIEMENT: { label: string; value: ModePaiement }[] = [
  { label: 'Especes', value: 'ESPECES' },
  { label: 'Mobile Money', value: 'MOBILE_MONEY' },
  { label: 'Cheque', value: 'CHEQUE' },
  { label: 'Virement', value: 'VIREMENT' },
  { label: 'Credit', value: 'CREDIT' },
];

export default function SaisieOperationScreen({ route, navigation }: Props): React.ReactElement {
  const { etapeId } = route.params;

  const [etapeInfo, setEtapeInfo] = useState<EtapeInfo | null>(null);
  const [lignes, setLignes] = useState<LigneState[]>([]);
  const [modePaiement, setModePaiement] = useState<ModePaiement>('ESPECES');
  const [montantManuel, setMontantManuel] = useState<string>('');
  const [montantCorrige, setMontantCorrige] = useState<boolean>(false);
  const [estEncaissee, setEstEncaissee] = useState<boolean>(true);
  const [commentaire, setCommentaire] = useState<string>('');
  const [signatureLivreur, setSignatureLivreur] = useState<string>('');
  const [signatureClient, setSignatureClient] = useState<string>('');
  const [nomSignataire, setNomSignataire] = useState<string>('');
  const [padVisible, setPadVisible] = useState<null | 'LIVREUR' | 'CLIENT'>(null);
  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const info = await getEtapeInfo(etapeId);
      if (!info) {
        Alert.alert('Erreur', 'Etape introuvable.');
        navigation.goBack();
        return;
      }
      const produits = await getProduitsSaisissables(etapeId, info.type_programme);
      setEtapeInfo(info);
      setLignes(
        produits.map((p) => ({
          produit: p,
          quantite: p.quantite_prevue != null ? String(p.quantite_prevue) : '0',
        })),
      );
      setLoading(false);
    })();
  }, [etapeId, navigation]);

  // Montant calcule automatiquement
  const montantCalcule = useMemo(() => {
    return lignes.reduce((sum, l) => {
      const q = parseInt(l.quantite, 10) || 0;
      return sum + q * l.produit.prix_unitaire;
    }, 0);
  }, [lignes]);

  const montantFinal = montantCorrige
    ? parseFloat(montantManuel) || 0
    : montantCalcule;

  function updateQuantite(index: number, valeur: string): void {
    const copy = [...lignes];
    copy[index].quantite = valeur.replace(/[^0-9]/g, '');
    setLignes(copy);
  }

  async function handleSave(): Promise<void> {
    if (!etapeInfo) return;

    const lignesSaisies = lignes
      .map((l) => ({
        produit_code_x3: l.produit.code_x3,
        quantite_realisee: parseInt(l.quantite, 10) || 0,
        montant_ligne: (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire,
      }))
      .filter((l) => l.quantite_realisee > 0);

    if (lignesSaisies.length === 0) {
      Alert.alert('Aucune quantite', 'Saisis au moins une quantite superieure a 0.');
      return;
    }

    setSaving(true);
    try {
      const typeOp = etapeInfo.type_programme === 'COLLECTE' ? 'COLLECTE' : 'RESTITUTION';
      const opUuid = await enregistrerOperation({
        etape_uuid: etapeInfo.uuid,
        type_operation: typeOp,
        sous_type: typeOp === 'COLLECTE' ? 'BCR' : null,
        mode_paiement: modePaiement,
        montant_total: montantFinal,
        montant_encaisse: estEncaissee ? montantFinal : 0,
        est_encaissee: estEncaissee,
        commentaire,
        signature_livreur: signatureLivreur,
        signature_client: signatureClient,
        nom_signataire_client: nomSignataire,
        lignes: lignesSaisies,
      });

      // Persister les photos rattachees a l'operation
      for (const ph of photos) {
        await ajouterPhotoOperation(
          opUuid, ph.uri, ph.type_photo, ph.tailleOctets, null, null,
        );
      }

      Alert.alert(
        'Operation enregistree',
        `L'operation${photos.length > 0 ? ' et ' + photos.length + ' photo(s)' : ''} enregistree(s) localement. Remontee a la prochaine synchronisation.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {etapeInfo && (
        <View style={styles.header}>
          <Text style={styles.typeOp}>{etapeInfo.type_programme}</Text>
          <Text style={styles.plvName}>{etapeInfo.plv_libelle}</Text>
          <Text style={styles.clientName}>{etapeInfo.client_raison_sociale}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Articles</Text>
      {lignes.map((ligne, index) => (
        <View key={ligne.produit.code_x3} style={styles.ligneCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.produitLibelle}>{ligne.produit.libelle}</Text>
            <Text style={styles.produitPrix}>
              {ligne.produit.prix_unitaire.toLocaleString('fr-FR')} FCFA / unite
            </Text>
            {ligne.produit.quantite_prevue != null && (
              <Text style={styles.prevue}>Prevu : {ligne.produit.quantite_prevue}</Text>
            )}
          </View>
          <TextInput
            style={styles.qteInput}
            value={ligne.quantite}
            onChangeText={(v) => updateQuantite(index, v)}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
      ))}

      <Text style={styles.sectionTitle}>Paiement</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Mode de paiement</Text>
        <View style={styles.pickerWrap}>
          <Picker
            selectedValue={modePaiement}
            onValueChange={(v) => setModePaiement(v as ModePaiement)}
          >
            {MODES_PAIEMENT.map((m) => (
              <Picker.Item key={m.value} label={m.label} value={m.value} />
            ))}
          </Picker>
        </View>

        <View style={styles.montantRow}>
          <Text style={styles.label}>Montant total (FCFA)</Text>
          <TouchableOpacity onPress={() => setMontantCorrige(!montantCorrige)}>
            <Text style={styles.toggleLink}>
              {montantCorrige ? 'Revenir au calcul auto' : 'Corriger manuellement'}
            </Text>
          </TouchableOpacity>
        </View>

        {montantCorrige ? (
          <TextInput
            style={styles.montantInput}
            value={montantManuel}
            onChangeText={(v) => setMontantManuel(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder={String(montantCalcule)}
          />
        ) : (
          <Text style={styles.montantAuto}>
            {montantCalcule.toLocaleString('fr-FR')} FCFA
            <Text style={styles.montantAutoHint}> (calcule)</Text>
          </Text>
        )}

        <View style={styles.switchRow}>
          <Text style={styles.label}>Montant encaisse ?</Text>
          <Switch value={estEncaissee} onValueChange={setEstEncaissee} />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Signatures</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Nom du signataire (client)</Text>
        <TextInput
          style={styles.nomInput}
          value={nomSignataire}
          onChangeText={setNomSignataire}
          placeholder="Nom du client signataire"
        />
        <View style={styles.sigRow}>
          <TouchableOpacity
            style={[styles.sigButton, signatureLivreur ? styles.sigDone : null]}
            onPress={() => setPadVisible('LIVREUR')}
          >
            <Text style={styles.sigButtonText}>
              {signatureLivreur ? 'Signature livreur OK' : 'Signer (livreur)'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sigButton, signatureClient ? styles.sigDone : null]}
            onPress={() => setPadVisible('CLIENT')}
          >
            <Text style={styles.sigButtonText}>
              {signatureClient ? 'Signature client OK' : 'Signer (client)'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Photos</Text>
      <PhotosSection photos={photos} onChange={setPhotos} />
      <Text style={styles.sectionTitle}>Commentaire (optionnel)</Text>
      <TextInput
        style={styles.commentaire}
        value={commentaire}
        onChangeText={setCommentaire}
        multiline
        placeholder="Remarque eventuelle..."
      />

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>Enregistrer l'operation</Text>
        )}
      </TouchableOpacity>

      <SignaturePad
        visible={padVisible !== null}
        titre={padVisible === 'LIVREUR' ? 'Signature du livreur' : 'Signature du client'}
        onSave={(sig) => {
          if (padVisible === 'LIVREUR') setSignatureLivreur(sig);
          else setSignatureClient(sig);
          setPadVisible(null);
        }}
        onCancel={() => setPadVisible(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#0d6efd', padding: 16 },
  typeOp: { color: '#cbe2ff', fontSize: 12, fontWeight: '700' },
  plvName: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  clientName: { color: '#cbe2ff', fontSize: 14 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: '#333',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  ligneCard: {
    backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8,
    padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center',
  },
  produitLibelle: { fontSize: 15, fontWeight: '600', color: '#333' },
  produitPrix: { fontSize: 12, color: '#888', marginTop: 2 },
  prevue: { fontSize: 12, color: '#0d6efd', marginTop: 2, fontWeight: '600' },
  qteInput: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    padding: 10, width: 64, textAlign: 'center', fontSize: 18,
    backgroundColor: '#fff',
  },
  card: { backgroundColor: '#fff', marginHorizontal: 12, padding: 14, borderRadius: 10 },
  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  pickerWrap: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, marginTop: 6, marginBottom: 12 },
  montantRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleLink: { color: '#0d6efd', fontSize: 13 },
  montantInput: {
    borderWidth: 1, borderColor: '#0d6efd', borderRadius: 8,
    padding: 12, fontSize: 18, marginTop: 6, backgroundColor: '#fff',
  },
  montantAuto: { fontSize: 22, fontWeight: '700', color: '#198754', marginTop: 6 },
  montantAutoHint: { fontSize: 13, fontWeight: '400', color: '#888' },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 14,
  },
  commentaire: {
    backgroundColor: '#fff', marginHorizontal: 12, padding: 12,
    borderRadius: 10, minHeight: 70, textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: '#198754', margin: 16, padding: 16,
    borderRadius: 10, alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  nomInput: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    padding: 10, marginTop: 6, marginBottom: 12, backgroundColor: '#fff',
  },
  sigRow: { flexDirection: 'row', gap: 8 },
  sigButton: {
    flex: 1, padding: 12, borderRadius: 8, alignItems: 'center',
    backgroundColor: '#6c757d',
  },
  sigDone: { backgroundColor: '#198754' },
  sigButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
