/**
 * Ecran de saisie d'une operation (collecte ou restitution) sur une etape.
 *
 * - RESTITUTION : produits prevus pre-remplis avec quantite prevue affichee.
 * - COLLECTE : tous les produits, quantites a 0 par defaut.
 * - Montant calcule auto (somme quantite x prix), corrigeable.
 * - Enregistrement local PENDING (offline-first).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import { acquerirPositionProbante, positionEstRecente, PositionQualifiee } from '../services/locationService';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapeInfo,
  getProduitsSaisissables,
  enregistrerOperation,
  marquerEtapeEchec,
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

interface PaymentFields {
  montantTotal: number;
  montantEncaisse: number;
  encaissee: boolean;
  modePaiementFinal: ModePaiement | null;
}

/**
 * Calcule les champs financiers selon le type d'opération et les saisies.
 * Retourne null si l'acompte saisi est invalide (<= 0) ; l'appelant affiche alors l'alerte.
 */
function computePaymentFields(
  isCollecte: boolean,
  avecAcompte: boolean,
  montantAcompte: string,
  montantFinal: number,
  estEncaissee: boolean,
  modePaiement: ModePaiement,
): PaymentFields | null {
  if (isCollecte) {
    if (avecAcompte) {
      const acompte = parseFloat(montantAcompte) || 0;
      if (acompte <= 0) return null;
      return { montantTotal: acompte, montantEncaisse: acompte, encaissee: true, modePaiementFinal: modePaiement };
    }
    // Collecte sans paiement : valeurs neutres
    return { montantTotal: 0, montantEncaisse: 0, encaissee: false, modePaiementFinal: null };
  }
  // Restitution : paiement obligatoire, montant calculé ou corrigé manuellement
  return {
    montantTotal: montantFinal,
    montantEncaisse: estEncaissee ? montantFinal : 0,
    encaissee: estEncaissee,
    modePaiementFinal: modePaiement,
  };
}

/**
 * Vérifie que les quantités saisies ne s'écartent pas fortement des prévisions.
 * Seuil : plus du double ET écart absolu > 5 (évite les faux positifs sur petites quantités).
 * Retourne true si tout est OK ou si le livreur confirme malgré l'écart.
 */
async function validateQuantiteEcart(lignes: LigneState[]): Promise<boolean> {
  const horsNorme = lignes.filter((l) => {
    if (l.produit.quantite_prevue == null) return false;
    const saisi = parseInt(l.quantite, 10) || 0;
    return saisi > l.produit.quantite_prevue * 2 && saisi - l.produit.quantite_prevue > 5;
  });
  if (horsNorme.length === 0) return true;
  const detail = horsNorme
    .map((l) => `${l.produit.libelle} : prevu ${l.produit.quantite_prevue}, saisi ${l.quantite}`)
    .join('\n');
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Ecart important detecte',
      `Les quantites suivantes s'ecartent fortement du prevu :\n\n${detail}\n\nConfirmes-tu ces valeurs ?`,
      [
        { text: 'Corriger', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirmer quand meme', onPress: () => resolve(true) },
      ],
    );
  });
}

export default function SaisieOperationScreen({ route, navigation }: Props): React.ReactElement {
  const { etapeId } = route.params;

  const [etapeInfo, setEtapeInfo] = useState<EtapeInfo | null>(null);
  const [lignes, setLignes] = useState<LigneState[]>([]);
  const [modePaiement, setModePaiement] = useState<ModePaiement>('ESPECES');
  const [montantManuel, setMontantManuel] = useState<string>('');
  const [montantCorrige, setMontantCorrige] = useState<boolean>(false);
  const [estEncaissee, setEstEncaissee] = useState<boolean>(true);
  // Acompte optionnel lors d'une collecte
  const [avecAcompte, setAvecAcompte] = useState<boolean>(false);
  const [montantAcompte, setMontantAcompte] = useState<string>('');
  const [commentaire, setCommentaire] = useState<string>('');
  const [signatureLivreur, setSignatureLivreur] = useState<string>('');
  const [signatureClient, setSignatureClient] = useState<string>('');
  const [nomSignataire, setNomSignataire] = useState<string>('');
  const [padVisible, setPadVisible] = useState<null | 'LIVREUR' | 'CLIENT'>(null);
  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);
  const [gpsStatus, setGpsStatus] = useState<'acquisition' | 'fiable' | 'degradee' | 'absente'>('acquisition');
  const positionRef = useRef<PositionQualifiee | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const isDirty = useRef<boolean>(false);

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

  // Alerte si l'utilisateur quitte avec des données saisies
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isDirty.current || saving) return;
      e.preventDefault();
      Alert.alert(
        'Quitter la saisie ?',
        'Les informations saisies seront perdues.',
        [
          { text: 'Rester', style: 'cancel' },
          { text: 'Quitter', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, saving]);

  // Warm-up GPS : démarrage dès l'ouverture pour laisser le chipset s'initialiser
  // pendant que l'utilisateur remplit le formulaire (cold start = 20-40 s).
  useEffect(() => {
    let annule = false;
    acquerirPositionProbante().then((pos) => {
      if (annule) return;
      positionRef.current = pos;
      setGpsStatus(pos.qualite === 'absente' ? 'absente' : pos.qualite);
    });
    return () => { annule = true; };
  }, []);

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
    isDirty.current = true;
    const copy = [...lignes];
    copy[index].quantite = valeur.replace(/[^0-9]/g, '');
    setLignes(copy);
  }

  async function handleSave(): Promise<void> {
    if (!etapeInfo) return;
    const isCollecte = etapeInfo.type_programme === 'COLLECTE';

    const lignesSaisies = lignes
      .map((l) => ({
        produit_code_x3: l.produit.code_x3,
        quantite_realisee: parseInt(l.quantite, 10) || 0,
        // Collecte = ramassage de vides, aucune transaction sur la bouteille elle-même.
        montant_ligne: isCollecte ? 0 : (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire,
      }))
      .filter((l) => l.quantite_realisee > 0);

    if (lignesSaisies.length === 0) {
      Alert.alert('Aucune quantite', 'Saisis au moins une quantite superieure a 0.');
      return;
    }

    const paiement = computePaymentFields(isCollecte, avecAcompte, montantAcompte, montantFinal, estEncaissee, modePaiement);
    if (paiement === null) {
      Alert.alert('Acompte invalide', "Saisis un montant d'acompte superieur a 0.");
      return;
    }

    if (!await validateQuantiteEcart(lignes)) return;

    setSaving(true);
    try {
      // Réutilise la position du warm-up si elle est récente (< 5 min),
      // sinon réacquiert (cas où l'utilisateur a mis très longtemps).
      const pos = (positionRef.current && positionEstRecente(positionRef.current))
        ? positionRef.current
        : await acquerirPositionProbante();
      setGpsStatus(pos.qualite === 'absente' ? 'absente' : pos.qualite);

      if (pos.qualite !== 'fiable') {
        const msg = pos.qualite === 'absente'
          ? "Aucune position GPS fiable n'a pu etre obtenue. L'operation sera enregistree SANS position. Continuer ?"
          : `Position GPS peu precise (${pos.precision ? Math.round(pos.precision) + ' m' : 'inconnue'}). Enregistrer quand meme ?`;
        const confirme = await new Promise<boolean>((resolve) => {
          Alert.alert('Position GPS', msg, [
            { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Enregistrer', onPress: () => resolve(true) },
          ]);
        });
        if (!confirme) { setSaving(false); return; }
      }

      const typeOp = isCollecte ? 'COLLECTE' : 'RESTITUTION';
      const opUuid = await enregistrerOperation({
        etape_uuid: etapeInfo.uuid,
        type_operation: typeOp,
        sous_type: typeOp === 'COLLECTE' ? 'BCR' : null,
        mode_paiement: paiement.modePaiementFinal,
        montant_total: paiement.montantTotal,
        montant_encaisse: paiement.montantEncaisse,
        est_encaissee: paiement.encaissee,
        latitude: pos.latitude,
        longitude: pos.longitude,
        gps_precision: pos.precision,
        gps_horodatage: pos.horodatage,
        commentaire,
        signature_livreur: signatureLivreur,
        signature_client: signatureClient,
        nom_signataire_client: nomSignataire,
        lignes: lignesSaisies,
      });

      for (const ph of photos) {
        await ajouterPhotoOperation(opUuid, ph.uri, ph.type_photo, ph.tailleOctets, pos.latitude, pos.longitude);
      }

      isDirty.current = false;
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
          <View style={styles.headerRow}>
            <View style={styles.gpsRow}>
              <View style={[styles.gpsDot, {
                backgroundColor:
                  gpsStatus === 'fiable'     ? '#34d399' :
                  gpsStatus === 'degradee'   ? '#fbbf24' :
                  gpsStatus === 'absente'    ? '#f87171' : '#94a3b8',
              }]} />
              <Text style={styles.gpsStatus}>
                {gpsStatus === 'fiable'     ? 'GPS fiable' :
                 gpsStatus === 'degradee'   ? 'GPS imprecis' :
                 gpsStatus === 'absente'    ? 'GPS absent' : 'GPS en cours...'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.itineraireBtn}
              onPress={() => {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${etapeInfo.plv_latitude},${etapeInfo.plv_longitude}`;
                Linking.openURL(url).catch(() => Alert.alert('Erreur', 'Impossible d\'ouvrir la navigation.'));
              }}
            >
              <Text style={styles.itineraireText}>Itineraire</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>
        {etapeInfo?.type_programme === 'COLLECTE' ? 'Bouteilles vides à collecter' : 'Articles'}
      </Text>
      {lignes.map((ligne, index) => (
        <View key={ligne.produit.code_x3} style={styles.ligneCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.produitLibelle}>{ligne.produit.libelle}</Text>
            {etapeInfo?.type_programme !== 'COLLECTE' && (
              <Text style={styles.produitPrix}>
                {ligne.produit.prix_unitaire.toLocaleString('fr-FR')} FCFA / unite (recharge)
              </Text>
            )}
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

      {etapeInfo?.type_programme === 'COLLECTE' ? (
        <>
          <Text style={styles.sectionTitle}>Acompte (optionnel)</Text>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.label}>Le client verse un acompte ?</Text>
              <Switch value={avecAcompte} onValueChange={setAvecAcompte} />
            </View>
            {avecAcompte && (
              <>
                <Text style={[styles.label, { marginTop: 14 }]}>Montant de l'acompte (FCFA)</Text>
                <TextInput
                  style={styles.montantInput}
                  value={montantAcompte}
                  onChangeText={(v) => setMontantAcompte(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
                <Text style={[styles.label, { marginTop: 14 }]}>Mode de paiement</Text>
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
              </>
            )}
          </View>
        </>
      ) : (
        <>
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
        </>
      )}

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
        onChangeText={(v) => { isDirty.current = true; setCommentaire(v); }}
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

      {etapeInfo && (
        <TouchableOpacity
          style={styles.echecButton}
          disabled={saving}
          onPress={() => {
            Alert.alert(
              'Marquer en echec',
              'Confirmes-tu que cette etape ne peut pas etre effectuee ? Elle sera marquee ECHEC et ne pourra plus etre saisie.',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Confirmer l\'echec',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await marquerEtapeEchec(etapeInfo.uuid);
                      isDirty.current = false;
                      navigation.goBack();
                    } catch (e: any) {
                      Alert.alert('Erreur', e?.message ?? String(e));
                    }
                  },
                },
              ],
            );
          }}
        >
          <Text style={styles.echecButtonText}>Je ne peux pas effectuer cette etape → Echec</Text>
        </TouchableOpacity>
      )}

      <SignaturePad
        visible={padVisible !== null}
        titre={padVisible === 'LIVREUR' ? 'Signature du livreur' : 'Signature du client'}
        onSave={(sig) => {
          isDirty.current = true;
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsStatus: { color: '#cbe2ff', fontSize: 12 },
  itineraireBtn: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  itineraireText: { color: '#0d6efd', fontWeight: '700', fontSize: 12 },
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
  echecButton: {
    marginHorizontal: 16, marginBottom: 16, padding: 14,
    borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#dc3545', backgroundColor: '#fff8f8',
  },
  echecButtonText: { color: '#dc3545', fontWeight: '600', fontSize: 14 },
});
