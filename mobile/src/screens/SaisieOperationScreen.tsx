/**
 * Écran de saisie d'opération terrain : cœur métier de l'application mobile.
 *
 * Formulaire de saisie d'une opération de collecte ou restitution de
 * bouteilles de gaz. Gère : articles (quantités), paiement, signatures
 * (livreur + client), photos, GPS et soumission locale (PENDING).
 *
 * On appelle acquerirPositionProbante()
 * dès le montage du composant pour que l'OS démarre le fix satellite en
 * avance. Au moment de la soumission, la position est souvent déjà prête.
 * positionEstRecente() vérifie si la position capturée à l'ouverture est
 * encore valide (< 5 min) : évite une double acquisition.
 *
 * BCR = Bon de Collecte Retour (emballages
 * vides récupérés). BCT = Bon de Collecte Transfert (cas particulier).
 * Ces sous-types correspondent aux types de documents Sage X3 qui seront
 * générés quand le flux retour X3 sera implémenté.
 *
 * L'opération principale,
 * ses lignes et le changement de statut de l'étape (-> VISITEE) sont
 * atomiques. Un échec partiel laisserait l'étape dans un état incohérent.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { NavigationAction } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import NeoDialog from '../components/NeoDialog';
import SignaturePad from '../components/SignaturePad';
import PhotosSection, { PhotoEnAttente } from '../components/PhotosSection';
import SaisieHeader from '../components/saisie/SaisieHeader';
import QuantitesSection from '../components/saisie/QuantitesSection';
import PaiementSection from '../components/saisie/PaiementSection';
import SignaturesSection from '../components/saisie/SignaturesSection';
import SectionHeader from '../components/saisie/SectionHeader';
import { LigneState, PaymentFields } from '../components/saisie/types';
import { neoCard, NEO, NEO_IN } from '../components/saisie/neoStyles';

import { ajouterPhotoOperation } from '../db/repositories/photoRepository';
import { acquerirPositionProbante, positionEstRecente, PositionQualifiee } from '../services/locationService';
import {
  getEtapeInfo,
  getArticlesSaisissables,
  enregistrerOperation,
  marquerEtapeEchec,
  EtapeInfo,
} from '../db/repositories/saisieRepository';
import { ModePaiement } from '../types/models';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SaisieOperation'>;

// ---------------------------------------------------------------------------
// Logique pure (sans état React)
// ---------------------------------------------------------------------------

function computePaymentFields(
  isCollecte: boolean, avecAcompte: boolean, montantAcompte: string,
  montantFinal: number, estEncaissee: boolean, modePaiement: ModePaiement,
): PaymentFields | null {
  if (isCollecte) {
    if (avecAcompte) {
      const a = parseFloat(montantAcompte) || 0;
      if (a <= 0) return null;
      return { montantTotal: a, montantEncaisse: a, encaissee: true, modePaiementFinal: modePaiement };
    }
    return { montantTotal: 0, montantEncaisse: 0, encaissee: false, modePaiementFinal: null };
  }
  return { montantTotal: montantFinal, montantEncaisse: estEncaissee ? montantFinal : 0, encaissee: estEncaissee, modePaiementFinal: modePaiement };
}

async function validateQuantiteEcart(lignes: LigneState[]): Promise<boolean> {
  const horsNorme = lignes.filter((l) => {
    if (l.produit.quantite_prevue == null) return false;
    const saisi = parseInt(l.quantite, 10) || 0;
    return saisi > l.produit.quantite_prevue * 2 && saisi - l.produit.quantite_prevue > 5;
  });
  if (horsNorme.length === 0) return true;
  const detail = horsNorme
    .map((l) => `${l.produit.libelle} : prévu ${l.produit.quantite_prevue}, saisi ${l.quantite}`)
    .join('\n');
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Écart important détecté',
      `Les quantités suivantes s'écartent fortement du prévu :\n\n${detail}\n\nConfirmes-tu ces valeurs ?`,
      [
        { text: 'Corriger',          style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirmer quand même',               onPress: () => resolve(true) },
      ],
    );
  });
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export default function SaisieOperationScreen({ route, navigation }: Props): React.ReactElement {
  const { etapeId } = route.params;

  const [etapeInfo, setEtapeInfo]           = useState<EtapeInfo | null>(null);
  const [lignes, setLignes]                 = useState<LigneState[]>([]);
  const [modePaiement, setModePaiement]     = useState<ModePaiement>('ESPECES');
  const [montantManuel, setMontantManuel]   = useState('');
  const [montantCorrige, setMontantCorrige] = useState(false);
  const [estEncaissee, setEstEncaissee]     = useState(true);
  const [avecAcompte, setAvecAcompte]       = useState(false);
  const [montantAcompte, setMontantAcompte] = useState('');
  const [commentaire, setCommentaire]       = useState('');
  const [signatureLivreur, setSignatureLivreur] = useState('');
  const [signatureClient, setSignatureClient]   = useState('');
  const [nomSignataire, setNomSignataire]       = useState('');
  const [padVisible, setPadVisible]     = useState<null | 'LIVREUR' | 'CLIENT'>(null);
  const [photos, setPhotos]             = useState<PhotoEnAttente[]>([]);
  const [gpsStatus, setGpsStatus]       = useState<'acquisition' | 'fiable' | 'degradee' | 'absente'>('acquisition');
  const positionRef                     = useRef<PositionQualifiee | null>(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const isDirty                         = useRef(false);
  const [showExitDialog, setShowExitDialog]           = useState(false);
  const [pendingExitAction, setPendingExitAction]     = useState<NavigationAction | null>(null);
  const [showEchecDialog, setShowEchecDialog]         = useState(false);
  const [showSigError, setShowSigError]               = useState(false);

  useEffect(() => {
    (async () => {
      const info = await getEtapeInfo(etapeId);
      if (!info) { Alert.alert('Erreur', 'Étape introuvable.'); navigation.goBack(); return; }
      const produits = await getArticlesSaisissables(etapeId, info.type_programme);
      setEtapeInfo(info);
      setLignes(produits.map((p) => ({ produit: p, quantite: p.quantite_prevue != null ? String(p.quantite_prevue) : '0' })));
      setLoading(false);
    })();
  }, [etapeId, navigation]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!isDirty.current || saving) return;
      e.preventDefault();
      setPendingExitAction(e.data.action);
      setShowExitDialog(true);
    });
    return unsub;
  }, [navigation, saving]);

  useEffect(() => {
    let annule = false;
    acquerirPositionProbante().then((pos) => {
      if (annule) return;
      positionRef.current = pos;
      setGpsStatus(pos.qualite === 'absente' ? 'absente' : pos.qualite);
    });
    return () => { annule = true; };
  }, []);

  const montantCalcule = useMemo(
    () => lignes.reduce((sum, l) => sum + (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire, 0),
    [lignes],
  );
  const montantFinal = montantCorrige ? parseFloat(montantManuel) || 0 : montantCalcule;

  function updateQuantite(index: number, valeur: string): void {
    isDirty.current = true;
    const copy = [...lignes];
    copy[index].quantite = valeur.replace(/[^0-9]/g, '');
    setLignes(copy);
  }

  async function handleSave(): Promise<void> {
    if (!etapeInfo) return;
    const isCollecte  = etapeInfo.type_programme === 'COLLECTE';
    const lignesSaisies = lignes
      .map((l) => ({
        produit_code_x3:  l.produit.code_x3,
        quantite_realisee: parseInt(l.quantite, 10) || 0,
        montant_ligne:    isCollecte ? 0 : (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire,
      }))
      .filter((l) => l.quantite_realisee > 0);

    if (lignesSaisies.length === 0) {
      Alert.alert('Aucune quantité', 'Saisis au moins une quantité supérieure à 0.');
      return;
    }
    const paiement = computePaymentFields(isCollecte, avecAcompte, montantAcompte, montantFinal, estEncaissee, modePaiement);
    if (paiement === null) { Alert.alert('Acompte invalide', "Saisis un montant d'acompte supérieur à 0."); return; }
    if (!signatureLivreur || !signatureClient) { setShowSigError(true); return; }
    setShowSigError(false);
    if (!await validateQuantiteEcart(lignes)) return;

    setSaving(true);
    try {
      const pos = (positionRef.current && positionEstRecente(positionRef.current))
        ? positionRef.current : await acquerirPositionProbante();
      setGpsStatus(pos.qualite === 'absente' ? 'absente' : pos.qualite);

      if (pos.qualite !== 'fiable') {
        const msg = pos.qualite === 'absente'
          ? "Aucune position GPS fiable n'a pu être obtenue. L'opération sera enregistrée SANS position. Continuer ?"
          : `Position GPS peu précise (${pos.precision ? Math.round(pos.precision) + ' m' : 'inconnue'}). Enregistrer quand même ?`;
        const confirme = await new Promise<boolean>((resolve) => {
          Alert.alert('Position GPS', msg, [
            { text: 'Annuler',       style: 'cancel', onPress: () => resolve(false) },
            { text: 'Enregistrer',                    onPress: () => resolve(true) },
          ]);
        });
        if (!confirme) { setSaving(false); return; }
      }

      const typeOp = isCollecte ? 'COLLECTE' : 'RESTITUTION';
      const opUuid = await enregistrerOperation({
        etape_uuid: etapeInfo.uuid, type_operation: typeOp,
        sous_type: typeOp === 'COLLECTE' ? 'BCR' : null,
        mode_paiement: paiement.modePaiementFinal,
        montant_total: paiement.montantTotal, montant_encaisse: paiement.montantEncaisse,
        est_encaissee: paiement.encaissee, latitude: pos.latitude, longitude: pos.longitude,
        gps_precision: pos.precision, gps_horodatage: pos.horodatage,
        commentaire, signature_livreur: signatureLivreur, signature_client: signatureClient,
        nom_signataire_client: nomSignataire, lignes: lignesSaisies,
      });
      for (const ph of photos) {
        await ajouterPhotoOperation(opUuid, ph.uri, ph.type_photo, ph.tailleOctets, pos.latitude, pos.longitude);
      }
      isDirty.current = false;
      Alert.alert(
        'Opération enregistrée',
        `Opération${photos.length > 0 ? ` et ${photos.length} photo(s)` : ''} enregistrée(s) localement. Remontée à la prochaine synchronisation.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;

  const isCollecte = etapeInfo?.type_programme === 'COLLECTE';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {etapeInfo && <SaisieHeader etapeInfo={etapeInfo} gpsStatus={gpsStatus} />}

      <QuantitesSection isCollecte={!!isCollecte} lignes={lignes} onUpdateQuantite={updateQuantite} />

      <PaiementSection
        isCollecte={!!isCollecte}
        modePaiement={modePaiement}      onModePaiementChange={setModePaiement}
        avecAcompte={avecAcompte}        onAvecAcompteChange={setAvecAcompte}
        montantAcompte={montantAcompte}  onMontantAcompteChange={setMontantAcompte}
        montantCalcule={montantCalcule}  montantFinal={montantFinal}
        montantManuel={montantManuel}    onMontantManuelChange={setMontantManuel}
        montantCorrige={montantCorrige}  onMontantCorrigeToggle={() => setMontantCorrige((v) => !v)}
        estEncaissee={estEncaissee}      onEstEncaisseeChange={setEstEncaissee}
      />

      <SignaturesSection
        nomSignataire={nomSignataire}    onNomSignataireChange={setNomSignataire}
        signatureLivreur={signatureLivreur}
        signatureClient={signatureClient}
        showSigError={showSigError}
        onOpenPad={(who) => { setShowSigError(false); setPadVisible(who); }}
        onClearSigError={() => setShowSigError(false)}
      />

      <SectionHeader icon="camera-outline" color="blue" title="Photos" />
      <View style={neoCard.outer}>
        <View style={neoCard.innerOverflow}>
          <PhotosSection photos={photos} onChange={setPhotos} cameraOnly />
        </View>
      </View>

      <SectionHeader icon="chatbubble-outline" color="gray" title="Commentaire" />
      <View style={neoCard.outer}>
        <View style={neoCard.inner}>
          <TextInput
            style={styles.commentaire}
            value={commentaire}
            onChangeText={(v) => { isDirty.current = true; setCommentaire(v); }}
            multiline
            placeholder="Remarque éventuelle..."
            placeholderTextColor="#3a5060"
            textAlignVertical="top"
          />
        </View>
      </View>

      <View style={[styles.saveBtnOuter, saving && { opacity: 0.5 }]}>
        <TouchableOpacity style={styles.saveBtnInner} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color="#fff" /> : (
            <>
              <Text style={styles.saveBtnText}>Enregistrer l'opération</Text>
              <Text style={styles.saveBtnSub}>{isCollecte ? 'Collecte' : 'Restitution'}{etapeInfo ? ` · ${etapeInfo.plv_libelle}` : ''}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {etapeInfo && (
        <View style={styles.echecOuter}>
          <TouchableOpacity style={styles.echecInner} disabled={saving} onPress={() => setShowEchecDialog(true)} activeOpacity={0.82}>
            <Ionicons name="close-circle-outline" size={14} color={Colors.danger} style={{ marginRight: 6 }} />
            <Text style={styles.echecBtnText}>Étape non réalisable — Marquer en échec</Text>
          </TouchableOpacity>
        </View>
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

      <NeoDialog
        visible={showEchecDialog}
        icon="close-circle-outline" iconColor={Colors.danger}
        title="Marquer en échec"
        message="Confirmes-tu que cette étape ne peut pas être effectuée ?"
        confirmLabel="Confirmer l'échec" cancelLabel="Annuler"
        danger
        onCancel={() => setShowEchecDialog(false)}
        onConfirm={async () => {
          setShowEchecDialog(false);
          try {
            await marquerEtapeEchec(etapeInfo!.uuid);
            isDirty.current = false;
            navigation.goBack();
          } catch (e: unknown) {
            Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
          }
        }}
      />

      <NeoDialog
        visible={showExitDialog}
        icon="warning-outline" iconColor={Colors.warning}
        title="Quitter la saisie ?"
        message="Les informations saisies seront perdues."
        confirmLabel="Quitter" cancelLabel="Rester"
        danger
        onCancel={() => { setShowExitDialog(false); setPendingExitAction(null); }}
        onConfirm={() => {
          setShowExitDialog(false);
          if (pendingExitAction) navigation.dispatch(pendingExitAction);
          setPendingExitAction(null);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: NEO },
  scroll: { paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO },

  commentaire: {
    minHeight: 80, fontSize: 14, color: '#1a2a3a', lineHeight: 20,
    backgroundColor: NEO_IN, borderRadius: 10, padding: 12,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#a8bac8', borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
  },

  saveBtnOuter: {
    marginHorizontal: 12, marginTop: 22, marginBottom: 8, borderRadius: 14,
    backgroundColor: Colors.brandOrange,
    shadowColor: '#5c1a00', shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  saveBtnInner: {
    borderRadius: 14, backgroundColor: Colors.brandOrange,
    paddingVertical: 17, paddingHorizontal: 20, alignItems: 'center',
    shadowColor: '#ffcc88', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.5, shadowRadius: 8,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#ffb060', borderLeftColor: '#ffb060',
    borderBottomColor: '#b83a00', borderRightColor: '#b83a00',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  saveBtnSub:  { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 4 },

  echecOuter: {
    marginHorizontal: 12, marginBottom: 8, borderRadius: 12,
    backgroundColor: Colors.dangerBg,
    shadowColor: '#991111', shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 5,
  },
  echecInner: {
    borderRadius: 12, backgroundColor: Colors.dangerBg,
    paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
    shadowColor: '#fff0f0', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.7, shadowRadius: 6,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#fdd', borderLeftColor: '#fdd', borderBottomColor: '#e88', borderRightColor: '#e88',
  },
  echecBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 13 },
});
