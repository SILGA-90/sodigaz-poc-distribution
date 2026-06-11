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
 * La collecte ramasse
 * des emballages vides (E*), opportuniste, sans plan. La restitution
 * livre du gaz plein (G*) selon le plan mock_x3. Les articles saisissables
 * sont filtrés par getArticlesSaisissables() selon le type de programme.
 *
 * Si le livreur rouvre le
 * formulaire d'une étape déjà saisie mais non synchronisée, on met à jour
 * l'opération existante plutôt que d'en créer une nouvelle (doublon interdit).
 * getOperationPendingPourEtape() détecte ce cas.
 *
 * BCR = Bon de Collecte Retour (emballages
 * vides récupérés). BCT = Bon de Collecte Transfert (cas particulier).
 * Ces sous-types correspondent aux types de documents Sage X3 qui seront
 * générés quand le flux retour X3 sera implémenté.
 *
 * Les signatures sont critiques pour la valeur
 * probante de l'opération. Un SVG natif (PanResponder + react-native-svg)
 * garantit zéro latence tactile et un rendu net sans WebView. Voir
 * SignaturePad.tsx.
 *
 * L'opération principale,
 * ses lignes et le changement de statut de l'étape (-> VISITEE) sont
 * atomiques. Un échec partiel laisserait l'étape dans un état incohérent.
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
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import NeoSelect from '../components/NeoSelect';
import NeoDialog from '../components/NeoDialog';
import SignaturePad from '../components/SignaturePad';
import PhotosSection, { PhotoEnAttente } from '../components/PhotosSection';
import { ajouterPhotoOperation } from '../db/repositories/photoRepository';
import { acquerirPositionProbante, positionEstRecente, PositionQualifiee } from '../services/locationService';
import { Ionicons } from '@expo/vector-icons';
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
import { Colors } from '../theme';

/* Palette néo */
const NEO     = '#e8edf2';
const NEO_SHD = '#4a6880';
const NEO_IN  = '#d4dde6';
const NAVY    = '#0a1628';
const TEXT    = '#1a2a3a';
const TEXT2   = '#3a5060';
const TEXT3   = '#3a5060';
const SEP     = '#c8d4de';

type Props = NativeStackScreenProps<RootStackParamList, 'SaisieOperation'>;
interface LigneState { produit: ProduitSaisie; quantite: string; }

const MODES_PAIEMENT: { label: string; value: ModePaiement }[] = [
  { label: 'Espèces',      value: 'ESPECES' },
  { label: 'Mobile Money', value: 'MOBILE_MONEY' },
  { label: 'Chèque',       value: 'CHEQUE' },
  { label: 'Virement',     value: 'VIREMENT' },
  { label: 'Crédit',       value: 'CREDIT' },
];

interface PaymentFields {
  montantTotal: number; montantEncaisse: number;
  encaissee: boolean; modePaiementFinal: ModePaiement | null;
}

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
  const detail = horsNorme.map((l) => `${l.produit.libelle} : prévu ${l.produit.quantite_prevue}, saisi ${l.quantite}`).join('\n');
  return new Promise<boolean>((resolve) => {
    Alert.alert('Écart important détecté',
      `Les quantités suivantes s'écartent fortement du prévu :\n\n${detail}\n\nConfirmes-tu ces valeurs ?`,
      [{ text: 'Corriger', style: 'cancel', onPress: () => resolve(false) },
       { text: 'Confirmer quand même', onPress: () => resolve(true) }]);
  });
}

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
  const [padVisible, setPadVisible] = useState<null | 'LIVREUR' | 'CLIENT'>(null);
  const [photos, setPhotos]         = useState<PhotoEnAttente[]>([]);
  const [gpsStatus, setGpsStatus]   = useState<'acquisition' | 'fiable' | 'degradee' | 'absente'>('acquisition');
  const positionRef = useRef<PositionQualifiee | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const isDirty = useRef(false);
  const [showExitDialog, setShowExitDialog]       = useState(false);
  const [pendingExitAction, setPendingExitAction] = useState<any>(null);
  const [showEchecDialog, setShowEchecDialog]     = useState(false);
  const [showSigError, setShowSigError]           = useState(false);

  useEffect(() => {
    (async () => {
      const info = await getEtapeInfo(etapeId);
      if (!info) { Alert.alert('Erreur', 'Étape introuvable.'); navigation.goBack(); return; }
      const produits = await getProduitsSaisissables(etapeId, info.type_programme);
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

  const montantCalcule = useMemo(() =>
    lignes.reduce((sum, l) => sum + (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire, 0),
  [lignes]);

  const montantFinal = montantCorrige ? parseFloat(montantManuel) || 0 : montantCalcule;

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
      .map((l) => ({ produit_code_x3: l.produit.code_x3, quantite_realisee: parseInt(l.quantite, 10) || 0, montant_ligne: isCollecte ? 0 : (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire }))
      .filter((l) => l.quantite_realisee > 0);
    if (lignesSaisies.length === 0) { Alert.alert('Aucune quantité', 'Saisis au moins une quantité supérieure à 0.'); return; }
    const paiement = computePaymentFields(isCollecte, avecAcompte, montantAcompte, montantFinal, estEncaissee, modePaiement);
    if (paiement === null) { Alert.alert('Acompte invalide', "Saisis un montant d'acompte supérieur à 0."); return; }
    if (!signatureLivreur || !signatureClient) {
      setShowSigError(true);
      return;
    }
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
            { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Enregistrer', onPress: () => resolve(true) },
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
      Alert.alert('Opération enregistrée',
        `Opération${photos.length > 0 ? ` et ${photos.length} photo(s)` : ''} enregistrée(s) localement. Remontée à la prochaine synchronisation.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;

  const isCollecte = etapeInfo?.type_programme === 'COLLECTE';
  const gpsColor = gpsStatus === 'fiable' ? Colors.success : gpsStatus === 'degradee' ? Colors.warning : gpsStatus === 'absente' ? Colors.danger : TEXT3;
  const gpsBg    = gpsStatus === 'fiable' ? Colors.successBg : gpsStatus === 'degradee' ? Colors.warningBg : gpsStatus === 'absente' ? Colors.dangerBg : NEO_IN;
  const gpsLabel = gpsStatus === 'fiable' ? 'GPS fiable' : gpsStatus === 'degradee' ? 'GPS imprécis' : gpsStatus === 'absente' ? 'GPS absent' : 'GPS...';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* Header navy */}
      {etapeInfo && (
        <View style={styles.header}>
          <View style={styles.bubble1} pointerEvents="none" />
          <View style={styles.bubble2} pointerEvents="none" />
          <View style={styles.headerContent}>
            <View style={styles.headerTopBar}>
              <View style={[styles.gpsPill, { backgroundColor: gpsBg, borderColor: gpsColor + '40' }]}>
                <View style={[styles.gpsDot, { backgroundColor: gpsColor }]} />
                <Text style={[styles.gpsPillText, { color: gpsColor }]}>{gpsLabel}</Text>
              </View>
              <TouchableOpacity
                style={styles.itineraireBtn}
                onPress={() => {
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${etapeInfo.plv_latitude},${etapeInfo.plv_longitude}`;
                  Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir la navigation."));
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.itineraireText}>Itinéraire ›</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.typeChip, isCollecte ? styles.typeChipC : styles.typeChipR]}>
              <Text style={styles.typeChipText}>{isCollecte ? 'Collecte' : 'Restitution'}</Text>
            </View>
            <Text style={styles.plvName}>{etapeInfo.plv_libelle}</Text>
            <Text style={styles.clientName}>{etapeInfo.client_raison_sociale}</Text>
          </View>
        </View>
      )}

      {/* QUANTITÉS */}
      <SectionHeader icon={isCollecte ? 'arrow-down-outline' : 'arrow-up-outline'} color="blue" title={isCollecte ? 'Bouteilles à collecter' : 'Quantités à livrer'} />
      <View style={styles.cardOuter}>
        <View style={styles.cardInner}>
          {lignes.map((ligne, index) => (
            <View key={`${ligne.produit.code_x3}_${index}`} style={[styles.ligneRow, index > 0 && styles.ligneRowSep]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.produitLibelle}>{ligne.produit.libelle}</Text>
                <View style={styles.produitMeta}>
                  <View style={styles.codeBadge}><Text style={styles.codeBadgeText}>{ligne.produit.code_x3}</Text></View>
                  {!isCollecte && <Text style={styles.produitPrix}>{ligne.produit.prix_unitaire.toLocaleString('fr-FR')} F/u</Text>}
                  {ligne.produit.quantite_prevue != null && (
                    <View style={styles.prevueBadge}><Text style={styles.prevueBadgeText}>Prévu : {ligne.produit.quantite_prevue}</Text></View>
                  )}
                </View>
              </View>
              {/* Stepper : raised */}
              <View style={styles.stepper}>
                <View style={styles.stepOuter}>
                  <TouchableOpacity style={styles.stepInner}
                    onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; if (c > 0) updateQuantite(index, String(c - 1)); }}
                    activeOpacity={0.8}>
                    <Text style={styles.stepBtnText}>−</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.qteInput}
                  value={ligne.quantite}
                  onChangeText={(v) => updateQuantite(index, v)}
                  keyboardType="number-pad"
                  maxLength={4}
                  textAlign="center"
                />
                <View style={styles.stepOuter}>
                  <TouchableOpacity style={styles.stepInner}
                    onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; updateQuantite(index, String(c + 1)); }}
                    activeOpacity={0.8}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* PAIEMENT */}
      {isCollecte ? (
        <>
          <SectionHeader icon="cash-outline" color="orange" title="Acompte (optionnel)" />
          <View style={styles.cardOuter}>
            <View style={styles.cardInner}>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Le client verse un acompte ?</Text>
                <Switch value={avecAcompte} onValueChange={setAvecAcompte}
                  trackColor={{ false: NEO_IN, true: Colors.brandOrange + '80' }}
                  thumbColor={avecAcompte ? Colors.brandOrange : '#94a3b8'} />
              </View>
              {avecAcompte && (
                <>
                  <View style={styles.fieldSep} />
                  <Text style={styles.label}>Montant de l'acompte (FCFA)</Text>
                  <FieldInput value={montantAcompte} onChangeText={(v) => setMontantAcompte(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
                  <View style={styles.fieldSep} />
                  <Text style={styles.label}>Mode de paiement</Text>
                  <FieldPicker selectedValue={modePaiement} onValueChange={(v) => setModePaiement(v as ModePaiement)} />
                </>
              )}
            </View>
          </View>
        </>
      ) : (
        <>
          <SectionHeader icon="cash-outline" color="green" title="Paiement" />
          <View style={styles.cardOuter}>
            <View style={styles.cardInner}>
              <Text style={styles.label}>Mode de paiement</Text>
              <FieldPicker selectedValue={modePaiement} onValueChange={(v) => setModePaiement(v as ModePaiement)} />
              <View style={styles.montantHeaderRow}>
                <Text style={styles.label}>Montant total</Text>
                <TouchableOpacity onPress={() => setMontantCorrige(!montantCorrige)}>
                  <Text style={styles.toggleLink}>{montantCorrige ? '← Calcul auto' : 'Corriger ›'}</Text>
                </TouchableOpacity>
              </View>
              {montantCorrige ? (
                <FieldInput value={montantManuel} onChangeText={(v) => setMontantManuel(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder={String(montantCalcule)} />
              ) : (
                <View style={styles.montantAutoRow}>
                  <Text style={styles.montantAutoValue}>{montantCalcule.toLocaleString('fr-FR')}</Text>
                  <Text style={styles.montantAutoUnit}> FCFA</Text>
                  <Text style={styles.montantAutoHint}> · calculé auto</Text>
                </View>
              )}
              <View style={styles.fieldSep} />
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.label}>Montant encaissé ?</Text>
                  <Text style={styles.switchSub}>Décocher si règlement différé</Text>
                </View>
                <Switch value={estEncaissee} onValueChange={setEstEncaissee}
                  trackColor={{ false: NEO_IN, true: Colors.success + '80' }}
                  thumbColor={estEncaissee ? Colors.success : '#94a3b8'} />
              </View>
            </View>
          </View>
        </>
      )}

      {/* SIGNATURES */}
      <SectionHeader icon="create-outline" color="navy" title="Signatures" />
      <View style={styles.cardOuter}>
        <View style={styles.cardInner}>
          <Text style={styles.label}>Nom du signataire (client)</Text>
          <FieldInput value={nomSignataire} onChangeText={setNomSignataire} placeholder="Nom complet du client" />
          <View style={styles.fieldSep} />
          {showSigError && (!signatureLivreur || !signatureClient) && (
            <View style={styles.sigErrorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} style={{ marginTop: 1 }} />
              <Text style={styles.sigErrorText}>
                {!signatureLivreur && !signatureClient
                  ? 'Les deux signatures sont obligatoires avant d\'enregistrer.'
                  : !signatureLivreur
                  ? 'La signature du livreur est obligatoire.'
                  : 'La signature du client est obligatoire.'}
              </Text>
            </View>
          )}
          <View style={styles.sigRow}>
            {(['LIVREUR', 'CLIENT'] as const).map((who) => {
              const signed  = who === 'LIVREUR' ? !!signatureLivreur : !!signatureClient;
              const missing = showSigError && !signed;
              return (
                <TouchableOpacity
                  key={who}
                  style={[styles.sigBtn, signed && styles.sigBtnDone, missing && styles.sigBtnError]}
                  onPress={() => { setShowSigError(false); setPadVisible(who); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sigIcon, signed && styles.sigIconDone, missing && styles.sigIconError]}>{signed ? '✓' : '✎'}</Text>
                  <Text style={[styles.sigLabel, signed && styles.sigLabelDone, missing && styles.sigLabelError]}>{who === 'LIVREUR' ? 'Livreur' : 'Client'}</Text>
                  <Text style={[styles.sigSub, signed && styles.sigSubDone, missing && styles.sigSubError]}>{signed ? 'Signé' : missing ? 'Obligatoire !' : 'Appuyer pour signer'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* PHOTOS */}
      <SectionHeader icon="camera-outline" color="blue" title="Photos" />
      <View style={styles.cardOuterNoPad}>
        <View style={styles.cardInnerNoPad}>
          <PhotosSection photos={photos} onChange={setPhotos} cameraOnly />
        </View>
      </View>

      {/* COMMENTAIRE */}
      <SectionHeader icon="chatbubble-outline" color="gray" title="Commentaire" />
      <View style={styles.cardOuter}>
        <View style={styles.cardInner}>
          <TextInput
            style={styles.commentaire}
            value={commentaire}
            onChangeText={(v) => { isDirty.current = true; setCommentaire(v); }}
            multiline
            placeholder="Remarque éventuelle..."
            placeholderTextColor={TEXT3}
            textAlignVertical="top"
          />
        </View>
      </View>

      {/* ENREGISTRER : raised orange */}
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

      {/* ÉCHEC : raised danger */}
      {etapeInfo && (
        <View style={styles.echecOuter}>
          <TouchableOpacity
            style={styles.echecInner}
            disabled={saving}
            onPress={() => setShowEchecDialog(true)}
            activeOpacity={0.82}
          >
            <Text style={styles.echecBtnText}>Étape non réalisable -> Marquer en échec</Text>
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

      {/* Dialog marquer en échec */}
      <NeoDialog
        visible={showEchecDialog}
        icon="close-circle-outline"
        iconColor={Colors.danger}
        title="Marquer en échec"
        message="Confirmes-tu que cette étape ne peut pas être effectuée ?"
        confirmLabel="Confirmer l'échec"
        cancelLabel="Annuler"
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

      {/* Dialog quitter la saisie */}
      <NeoDialog
        visible={showExitDialog}
        icon="warning-outline"
        iconColor={Colors.warning}
        title="Quitter la saisie ?"
        message="Les informations saisies seront perdues."
        confirmLabel="Quitter"
        cancelLabel="Rester"
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

/* Sous-composants */

type IconColor = 'blue' | 'green' | 'orange' | 'navy' | 'gray';
function SectionHeader({ icon, color, title }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: IconColor; title: string }) {
  const bg: Record<IconColor, string> = { blue: Colors.infoBg, green: Colors.successBg, orange: Colors.warningBg, navy: NEO_IN, gray: NEO_IN };
  const fg: Record<IconColor, string> = { blue: Colors.brandBlue, green: Colors.success, orange: Colors.brandOrange, navy: TEXT2, gray: TEXT3 };
  return (
    <View style={shS.row}>
      <View style={[shS.iconBox, { backgroundColor: bg[color] }]}>
        <Ionicons name={icon} size={16} color={fg[color]} />
      </View>
      <Text style={shS.title}>{title}</Text>
    </View>
  );
}
const shS = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 22, marginBottom: 8 },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: 15, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
});

function FieldInput({ value, onChangeText, placeholder, keyboardType }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: TextInputProps['keyboardType'];
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[fiS.input, focused && fiS.inputFocused]}
      value={value} onChangeText={onChangeText}
      placeholder={placeholder} placeholderTextColor="#8fa4b4"
      keyboardType={keyboardType} autoCorrect={false}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    />
  );
}
const fiS = StyleSheet.create({
  input: {
    marginTop: 8,
    backgroundColor: NEO_IN,
    borderRadius: 10,
    borderTopWidth:    1.5, borderLeftWidth:    1.5,
    borderBottomWidth: 1.5, borderRightWidth:   1.5,
    borderTopColor: '#a8bac8',   borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: TEXT,
  },
  inputFocused: {
    borderTopColor: Colors.brandBlue,   borderLeftColor: Colors.brandBlue,
    borderBottomColor: '#b0daf2',       borderRightColor: '#b0daf2',
    backgroundColor: '#cce6f4',
  },
});

function FieldPicker({ selectedValue, onValueChange }: { selectedValue: string; onValueChange: (v: string) => void }) {
  return (
    <NeoSelect
      value={selectedValue}
      onChange={onValueChange}
      options={MODES_PAIEMENT.map((m) => ({ label: m.label, value: m.value }))}
    />
  );
}

/* Styles */
const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: NEO },
  scroll: { paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO },

  /* Header navy */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -55, right: -40, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 35, right: 100, backgroundColor: 'rgba(7,155,217,0.07)' },
  headerContent: { padding: 16, paddingBottom: 22 },
  headerTopBar:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

  gpsPill:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  gpsDot:      { width: 7, height: 7, borderRadius: 4 },
  gpsPillText: { fontSize: 12, fontWeight: '700' },

  itineraireBtn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16,
    backgroundColor: Colors.brandBlue,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#2bb8ef', borderLeftColor: '#2bb8ef',
    borderBottomColor: '#046a96', borderRightColor: '#046a96',
  },
  itineraireText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  typeChip:  { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginBottom: 8, borderWidth: 1 },
  typeChipC: { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  typeChipR: { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  plvName:    { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  clientName: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 3 },

  /* Cartes de section raised */
  cardOuter: {
    marginHorizontal: 12,
    marginBottom:     4,
    borderRadius:     14,
    backgroundColor:  NEO,
    shadowColor:      NEO_SHD,
    shadowOffset:     { width: 6, height: 6 },
    shadowOpacity:    1,
    shadowRadius:     7,
    elevation:        10,
  },
  cardInner: {
    borderRadius:      14,
    backgroundColor:   NEO,
    shadowColor:       '#ffffff',
    shadowOffset:      { width: -6, height: -6 },
    shadowOpacity:     1,
    shadowRadius:      7,
    padding:           14,
    borderTopWidth:    1.5, borderLeftWidth:    1.5,
    borderBottomWidth: 1.5, borderRightWidth:   1.5,
    borderTopColor:    '#ffffff',
    borderLeftColor:   '#ffffff',
    borderBottomColor: '#8aa8c0',
    borderRightColor:  '#8aa8c0',
  },
  cardOuterNoPad: {
    marginHorizontal: 12,
    marginBottom:     4,
    borderRadius:     14,
    backgroundColor:  NEO,
    shadowColor:      NEO_SHD,
    shadowOffset:     { width: 6, height: 6 },
    shadowOpacity:    1,
    shadowRadius:     7,
    elevation:        10,
  },
  cardInnerNoPad: {
    borderRadius:      14,
    backgroundColor:   NEO,
    shadowColor:       '#ffffff',
    shadowOffset:      { width: -6, height: -6 },
    shadowOpacity:     1,
    shadowRadius:      7,
    overflow:          'hidden',
    borderTopWidth:    1.5, borderLeftWidth:    1.5,
    borderBottomWidth: 1.5, borderRightWidth:   1.5,
    borderTopColor:    '#ffffff',
    borderLeftColor:   '#ffffff',
    borderBottomColor: '#8aa8c0',
    borderRightColor:  '#8aa8c0',
  },
  fieldSep: { height: 1, backgroundColor: SEP, marginVertical: 12 },

  /* Lignes produit */
  ligneRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  ligneRowSep: { borderTopWidth: 1, borderTopColor: SEP },
  produitLibelle: { fontSize: 14, fontWeight: '700', color: TEXT },
  produitMeta:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  codeBadge:      { backgroundColor: NEO_IN, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  codeBadgeText:  { fontSize: 11, fontWeight: '600', color: TEXT3 },
  produitPrix:    { fontSize: 11, color: TEXT3 },
  prevueBadge:    { backgroundColor: Colors.infoBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  prevueBadgeText:{ fontSize: 11, fontWeight: '700', color: Colors.brandBlue },

  /* Stepper raised */
  stepper:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepOuter: {
    borderRadius:    10,
    backgroundColor: NEO,
    shadowColor:     NEO_SHD,
    shadowOffset:    { width: 4, height: 4 },
    shadowOpacity:   1,
    shadowRadius:    5,
    elevation:       6,
  },
  stepInner: {
    width: 44, height: 48, borderRadius: 10,
    backgroundColor: NEO,
    shadowColor:     '#ffffff',
    shadowOffset:    { width: -3, height: -3 },
    shadowOpacity:   1,
    shadowRadius:    4,
    alignItems:      'center',
    justifyContent:  'center',
    borderTopWidth:    1, borderLeftWidth:    1,
    borderBottomWidth: 1, borderRightWidth:   1,
    borderTopColor:    '#ffffff', borderLeftColor:    '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor:   '#8aa8c0',
  },
  stepBtnText: { fontSize: 26, fontWeight: '700', color: TEXT, lineHeight: 30 },
  /* Champ quantité : inset */
  qteInput: {
    width: 56, height: 48, borderRadius: 10,
    backgroundColor: NEO_IN,
    borderTopWidth:    1.5, borderLeftWidth:    1.5,
    borderBottomWidth: 1.5, borderRightWidth:   1.5,
    borderTopColor: '#a8bac8',   borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
    fontSize: 18, fontWeight: '700', color: TEXT, textAlign: 'center',
  },

  /* Labels & champs */
  label:     { fontSize: 13, fontWeight: '700', color: TEXT2, marginTop: 2 },
  switchSub: { fontSize: 11, color: TEXT3, marginTop: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  montantHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  toggleLink: { color: Colors.brandBlue, fontSize: 13, fontWeight: '600' },
  montantAutoRow:   { flexDirection: 'row', alignItems: 'baseline', marginTop: 8, marginBottom: 4 },
  montantAutoValue: { fontSize: 26, fontWeight: '800', color: Colors.success, letterSpacing: -0.5 },
  montantAutoUnit:  { fontSize: 14, fontWeight: '700', color: Colors.success },
  montantAutoHint:  { fontSize: 12, color: TEXT3 },

  /* Signatures */
  sigRow: { flexDirection: 'row', gap: 10 },
  sigBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center',
    backgroundColor: NEO,
    shadowColor:     NEO_SHD,
    shadowOffset:    { width: 5, height: 5 },
    shadowOpacity:   1,
    shadowRadius:    6,
    elevation:       7,
    borderTopWidth:    1.5, borderLeftWidth:    1.5,
    borderBottomWidth: 1.5, borderRightWidth:   1.5,
    borderTopColor:    '#ffffff', borderLeftColor:    '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor:   '#8aa8c0',
  },
  sigBtnDone: {
    backgroundColor:   Colors.successBg,
    shadowColor:       '#107a30',
    shadowOpacity:     0.4,
    borderTopColor:    'rgba(210,255,230,0.8)', borderLeftColor:    'rgba(210,255,230,0.8)',
    borderBottomColor: Colors.successBorder,    borderRightColor:   Colors.successBorder,
  },
  sigIcon:     { fontSize: 22, marginBottom: 5, color: TEXT3 },
  sigIconDone: { color: Colors.success },
  sigLabel:    { fontSize: 13, fontWeight: '700', color: TEXT2 },
  sigLabelDone:{ color: Colors.success },
  sigSub:      { fontSize: 10, color: TEXT3, marginTop: 2, textAlign: 'center' },
  sigSubDone:  { color: Colors.success },
  sigBtnError: {
    backgroundColor:   Colors.dangerBg,
    shadowColor:       '#991b1b',
    shadowOpacity:     0.35,
    borderTopColor:    '#fdd',              borderLeftColor:    '#fdd',
    borderBottomColor: Colors.dangerBorder, borderRightColor:   Colors.dangerBorder,
  },
  sigIconError:  { color: Colors.danger },
  sigLabelError: { color: Colors.danger },
  sigSubError:   { color: Colors.danger, fontWeight: '700' },
  sigErrorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginBottom: 12, padding: 11, borderRadius: 10,
    backgroundColor: Colors.dangerBg,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#fdd',              borderLeftColor: '#fdd',
    borderBottomColor: Colors.dangerBorder, borderRightColor: Colors.dangerBorder,
  },
  sigErrorText: { flex: 1, fontSize: 13, color: Colors.danger, lineHeight: 18 },

  /* Commentaire : inset */
  commentaire: {
    minHeight: 80, fontSize: 14, color: TEXT, lineHeight: 20,
    backgroundColor: NEO_IN, borderRadius: 10, padding: 12,
    borderTopWidth:    1.5, borderLeftWidth:    1.5,
    borderBottomWidth: 1.5, borderRightWidth:   1.5,
    borderTopColor: '#a8bac8',   borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
  },

  /* Bouton Enregistrer : raised orange */
  saveBtnOuter: {
    marginHorizontal: 12, marginTop: 22, marginBottom: 8,
    borderRadius:     14,
    backgroundColor:  Colors.brandOrange,
    shadowColor:      '#5c1a00',
    shadowOffset:     { width: 6, height: 6 },
    shadowOpacity:    1,
    shadowRadius:     7,
    elevation:        10,
  },
  saveBtnInner: {
    borderRadius:    14,
    backgroundColor: Colors.brandOrange,
    paddingVertical: 17, paddingHorizontal: 20, alignItems: 'center',
    shadowColor:     '#ffcc88',
    shadowOffset:    { width: -4, height: -4 },
    shadowOpacity:   0.5,
    shadowRadius:    8,
    borderTopWidth:    1, borderLeftWidth:    1,
    borderBottomWidth: 1, borderRightWidth:   1,
    borderTopColor:    '#ffb060', borderLeftColor:    '#ffb060',
    borderBottomColor: '#b83a00', borderRightColor:   '#b83a00',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  saveBtnSub:  { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 4 },

  /* Bouton Échec : raised danger */
  echecOuter: {
    marginHorizontal: 12, marginBottom: 8,
    borderRadius:     12,
    backgroundColor:  Colors.dangerBg,
    shadowColor:      '#991111',
    shadowOffset:     { width: 5, height: 5 },
    shadowOpacity:    0.35,
    shadowRadius:     8,
    elevation:        5,
  },
  echecInner: {
    borderRadius:    12,
    backgroundColor: Colors.dangerBg,
    paddingVertical: 13, alignItems: 'center',
    shadowColor:     '#fff0f0',
    shadowOffset:    { width: -3, height: -3 },
    shadowOpacity:   0.7,
    shadowRadius:    6,
    borderTopWidth:    1, borderLeftWidth:    1,
    borderBottomWidth: 1, borderRightWidth:   1,
    borderTopColor:    '#fdd',  borderLeftColor:    '#fdd',
    borderBottomColor: '#e88',  borderRightColor:   '#e88',
  },
  echecBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 13 },
});
