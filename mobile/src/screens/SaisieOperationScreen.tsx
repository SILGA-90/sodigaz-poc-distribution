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
  { label: 'Espèces',      value: 'ESPECES' },
  { label: 'Mobile Money', value: 'MOBILE_MONEY' },
  { label: 'Chèque',       value: 'CHEQUE' },
  { label: 'Virement',     value: 'VIREMENT' },
  { label: 'Crédit',       value: 'CREDIT' },
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
    return { montantTotal: 0, montantEncaisse: 0, encaissee: false, modePaiementFinal: null };
  }
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
    .map((l) => `${l.produit.libelle} : prévu ${l.produit.quantite_prevue}, saisi ${l.quantite}`)
    .join('\n');
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Écart important détecté',
      `Les quantités suivantes s'écartent fortement du prévu :\n\n${detail}\n\nConfirmes-tu ces valeurs ?`,
      [
        { text: 'Corriger', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirmer quand même', onPress: () => resolve(true) },
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
        Alert.alert('Erreur', 'Étape introuvable.');
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

  // Warm-up GPS dès l'ouverture (cold start = 20-40 s).
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
        montant_ligne: isCollecte ? 0 : (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire,
      }))
      .filter((l) => l.quantite_realisee > 0);

    if (lignesSaisies.length === 0) {
      Alert.alert('Aucune quantité', 'Saisis au moins une quantité supérieure à 0.');
      return;
    }

    const paiement = computePaymentFields(isCollecte, avecAcompte, montantAcompte, montantFinal, estEncaissee, modePaiement);
    if (paiement === null) {
      Alert.alert('Acompte invalide', "Saisis un montant d'acompte supérieur à 0.");
      return;
    }

    if (!await validateQuantiteEcart(lignes)) return;

    setSaving(true);
    try {
      const pos = (positionRef.current && positionEstRecente(positionRef.current))
        ? positionRef.current
        : await acquerirPositionProbante();
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
        'Opération enregistrée',
        `Opération${photos.length > 0 ? ` et ${photos.length} photo(s)` : ''} enregistrée(s) localement. Remontée à la prochaine synchronisation.`,
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
        <ActivityIndicator size="large" color="#1a7fba" />
      </View>
    );
  }

  const isCollecte = etapeInfo?.type_programme === 'COLLECTE';

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }}>

      {/* ══ HEADER ══ */}
      {etapeInfo && (
        <View style={styles.header}>
          {/* Cercles décoratifs */}
          <View style={styles.bgCircle1} pointerEvents="none" />
          <View style={styles.bgCircle2} pointerEvents="none" />

          <View style={styles.headerContent}>
            {/* GPS + itinéraire */}
            <View style={styles.headerTopBar}>
              <View style={[styles.gpsPill, {
                backgroundColor:
                  gpsStatus === 'fiable'   ? 'rgba(52,211,153,0.18)' :
                  gpsStatus === 'degradee' ? 'rgba(251,191,36,0.18)' :
                  gpsStatus === 'absente'  ? 'rgba(248,113,113,0.18)' :
                                            'rgba(148,163,184,0.18)',
              }]}>
                <View style={[styles.gpsDot, {
                  backgroundColor:
                    gpsStatus === 'fiable'   ? '#34d399' :
                    gpsStatus === 'degradee' ? '#fbbf24' :
                    gpsStatus === 'absente'  ? '#f87171' : '#94a3b8',
                }]} />
                <Text style={styles.gpsPillText}>
                  {gpsStatus === 'fiable'   ? 'GPS fiable' :
                   gpsStatus === 'degradee' ? 'GPS imprécis' :
                   gpsStatus === 'absente'  ? 'GPS absent' : 'GPS…'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.itineraireBtn}
                onPress={() => {
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${etapeInfo.plv_latitude},${etapeInfo.plv_longitude}`;
                  Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir la navigation."));
                }}
              >
                <Text style={styles.itineraireText}>Itinéraire ›</Text>
              </TouchableOpacity>
            </View>

            {/* Chip type opération */}
            <View style={[styles.typeChip, isCollecte ? styles.typeChipCollecte : styles.typeChipRestit]}>
              <Text style={styles.typeChipText}>
                {isCollecte ? 'Collecte' : 'Restitution'}
              </Text>
            </View>

            {/* PLV + client */}
            <Text style={styles.plvName}>{etapeInfo.plv_libelle}</Text>
            <Text style={styles.clientName}>{etapeInfo.client_raison_sociale}</Text>
          </View>
        </View>
      )}

      {/* ══ QUANTITÉS ══ */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, styles.sectionIconBlue]}>
          <Text style={styles.sectionIconText}>{isCollecte ? '↓' : '↑'}</Text>
        </View>
        <Text style={styles.sectionTitle}>
          {isCollecte ? 'Bouteilles à collecter' : 'Quantités à livrer'}
        </Text>
      </View>
      <View style={styles.sectionCard}>
        {lignes.map((ligne, index) => (
          <View key={ligne.produit.code_x3} style={[styles.ligneRow, index > 0 && styles.ligneRowSep]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.produitLibelle}>{ligne.produit.libelle}</Text>
              <View style={styles.produitMeta}>
                <Text style={styles.produitCode}>{ligne.produit.code_x3}</Text>
                {!isCollecte && (
                  <Text style={styles.produitPrix}>
                    {ligne.produit.prix_unitaire.toLocaleString('fr-FR')} F/u
                  </Text>
                )}
                {ligne.produit.quantite_prevue != null && (
                  <View style={styles.prevueBadge}>
                    <Text style={styles.prevueBadgeText}>Prévu : {ligne.produit.quantite_prevue}</Text>
                  </View>
                )}
              </View>
            </View>
            {/* Stepper +/− */}
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => {
                  const cur = parseInt(ligne.quantite, 10) || 0;
                  if (cur > 0) updateQuantite(index, String(cur - 1));
                }}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.qteInput}
                value={ligne.quantite}
                onChangeText={(v) => updateQuantite(index, v)}
                keyboardType="number-pad"
                maxLength={4}
                textAlign="center"
              />
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => {
                  const cur = parseInt(ligne.quantite, 10) || 0;
                  updateQuantite(index, String(cur + 1));
                }}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* ══ PAIEMENT ══ */}
      {isCollecte ? (
        <>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconBox, styles.sectionIconOrange]}>
              <Text style={styles.sectionIconText}>$</Text>
            </View>
            <Text style={styles.sectionTitle}>Acompte (optionnel)</Text>
          </View>
          <View style={styles.sectionCard}>
            <View style={styles.switchRow}>
              <Text style={styles.label}>Le client verse un acompte ?</Text>
              <Switch
                value={avecAcompte}
                onValueChange={setAvecAcompte}
                trackColor={{ false: '#e2e8f0', true: 'rgba(244,121,32,0.4)' }}
                thumbColor={avecAcompte ? '#f47920' : '#94a3b8'}
              />
            </View>
            {avecAcompte && (
              <>
                <View style={styles.fieldSep} />
                <Text style={styles.label}>Montant de l'acompte (FCFA)</Text>
                <TextInput
                  style={styles.montantInput}
                  value={montantAcompte}
                  onChangeText={(v) => setMontantAcompte(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                />
                <View style={styles.fieldSep} />
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
              </>
            )}
          </View>
        </>
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconBox, styles.sectionIconGreen]}>
              <Text style={styles.sectionIconText}>$</Text>
            </View>
            <Text style={styles.sectionTitle}>Paiement</Text>
          </View>
          <View style={styles.sectionCard}>
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

            <View style={styles.montantHeaderRow}>
              <Text style={styles.label}>Montant total</Text>
              <TouchableOpacity onPress={() => setMontantCorrige(!montantCorrige)}>
                <Text style={styles.toggleLink}>
                  {montantCorrige ? '← Calcul auto' : 'Corriger ›'}
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
                placeholderTextColor="#94a3b8"
              />
            ) : (
              <View style={styles.montantAutoRow}>
                <Text style={styles.montantAutoValue}>
                  {montantCalcule.toLocaleString('fr-FR')}
                </Text>
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
              <Switch
                value={estEncaissee}
                onValueChange={setEstEncaissee}
                trackColor={{ false: '#e2e8f0', true: 'rgba(25,135,84,0.4)' }}
                thumbColor={estEncaissee ? '#198754' : '#94a3b8'}
              />
            </View>
          </View>
        </>
      )}

      {/* ══ SIGNATURES ══ */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, styles.sectionIconNavy]}>
          <Text style={styles.sectionIconText}>✎</Text>
        </View>
        <Text style={styles.sectionTitle}>Signatures</Text>
      </View>
      <View style={styles.sectionCard}>
        <Text style={styles.label}>Nom du signataire (client)</Text>
        <TextInput
          style={styles.nomInput}
          value={nomSignataire}
          onChangeText={setNomSignataire}
          placeholder="Nom complet du client"
          placeholderTextColor="#94a3b8"
        />
        <View style={styles.fieldSep} />
        <View style={styles.sigRow}>
          <TouchableOpacity
            style={[styles.sigButton, signatureLivreur ? styles.sigDone : styles.sigPending]}
            onPress={() => setPadVisible('LIVREUR')}
          >
            <Text style={styles.sigIcon}>{signatureLivreur ? '✓' : '✎'}</Text>
            <Text style={[styles.sigButtonLabel, signatureLivreur && styles.sigButtonLabelDone]}>
              Livreur
            </Text>
            <Text style={[styles.sigButtonSub, signatureLivreur && styles.sigButtonSubDone]}>
              {signatureLivreur ? 'Signé' : 'Appuyer pour signer'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sigButton, signatureClient ? styles.sigDone : styles.sigPending]}
            onPress={() => setPadVisible('CLIENT')}
          >
            <Text style={styles.sigIcon}>{signatureClient ? '✓' : '✎'}</Text>
            <Text style={[styles.sigButtonLabel, signatureClient && styles.sigButtonLabelDone]}>
              Client
            </Text>
            <Text style={[styles.sigButtonSub, signatureClient && styles.sigButtonSubDone]}>
              {signatureClient ? 'Signé' : 'Appuyer pour signer'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ══ PHOTOS ══ */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, styles.sectionIconBlue]}>
          <Text style={styles.sectionIconText}>▣</Text>
        </View>
        <Text style={styles.sectionTitle}>Photos</Text>
      </View>
      <View style={styles.sectionCardNoPad}>
        <PhotosSection photos={photos} onChange={setPhotos} cameraOnly />
      </View>

      {/* ══ COMMENTAIRE ══ */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, styles.sectionIconGray]}>
          <Text style={styles.sectionIconText}>≡</Text>
        </View>
        <Text style={styles.sectionTitle}>Commentaire</Text>
      </View>
      <View style={styles.sectionCard}>
        <TextInput
          style={styles.commentaire}
          value={commentaire}
          onChangeText={(v) => { isDirty.current = true; setCommentaire(v); }}
          multiline
          placeholder="Remarque éventuelle…"
          placeholderTextColor="#94a3b8"
          textAlignVertical="top"
        />
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
            <Text style={styles.saveText}>Enregistrer l'opération</Text>
            <Text style={styles.saveSub}>
              {isCollecte ? 'Collecte' : 'Restitution'}
              {etapeInfo ? ` · ${etapeInfo.plv_libelle}` : ''}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* ══ BOUTON ÉCHEC ══ */}
      {etapeInfo && (
        <TouchableOpacity
          style={styles.echecButton}
          disabled={saving}
          onPress={() => {
            Alert.alert(
              'Marquer en échec',
              "Confirmes-tu que cette étape ne peut pas être effectuée ? Elle sera marquée ÉCHEC et ne pourra plus être saisie.",
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: "Confirmer l'échec",
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
          <Text style={styles.echecButtonText}>Étape non réalisable → Marquer en échec</Text>
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
  container: { flex: 1, backgroundColor: '#f1f4f8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── Header
  header: { backgroundColor: '#0a1628', overflow: 'hidden', marginBottom: 4 },
  bgCircle1: {
    position: 'absolute', width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(26,127,186,0.22)', top: -55, right: -40, zIndex: 0,
  },
  bgCircle2: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55,
    backgroundColor: 'rgba(26,127,186,0.12)', top: 35, right: 100, zIndex: 0,
  },
  headerContent: { padding: 16, paddingBottom: 20, zIndex: 1 },

  headerTopBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  gpsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  gpsDot: { width: 7, height: 7, borderRadius: 4 },
  gpsPillText: { fontSize: 12, fontWeight: '600', color: '#e2e8f0' },
  itineraireBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  itineraireText: { color: '#e2e8f0', fontWeight: '700', fontSize: 12 },

  typeChip: {
    alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 20, marginBottom: 8,
  },
  typeChipCollecte: {
    backgroundColor: 'rgba(26,127,186,0.4)', borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.55)',
  },
  typeChipRestit: {
    backgroundColor: 'rgba(25,135,84,0.4)', borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.55)',
  },
  typeChipText: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },

  plvName:    { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  clientName: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 3 },

  // ── En-têtes de section
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginHorizontal: 14, marginTop: 20, marginBottom: 8,
  },
  sectionIconBox: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionIconBlue:   { backgroundColor: 'rgba(26,127,186,0.12)' },
  sectionIconGreen:  { backgroundColor: 'rgba(25,135,84,0.12)' },
  sectionIconOrange: { backgroundColor: 'rgba(244,121,32,0.12)' },
  sectionIconNavy:   { backgroundColor: 'rgba(10,22,40,0.1)' },
  sectionIconGray:   { backgroundColor: 'rgba(148,163,184,0.15)' },
  sectionIconText:   { fontSize: 15, fontWeight: '800', color: '#0a1628' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0a1628', letterSpacing: -0.2 },

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
  fieldSep: { height: 1, backgroundColor: '#f1f4f8', marginVertical: 12 },

  // ── Lignes produits + stepper
  ligneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  ligneRowSep: { borderTopWidth: 1, borderTopColor: '#f1f4f8' },
  produitLibelle: { fontSize: 14, fontWeight: '700', color: '#0a1628' },
  produitMeta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap',
  },
  produitCode: {
    fontSize: 11, fontWeight: '600', color: '#6c757d',
    backgroundColor: '#f1f4f8', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },
  produitPrix: { fontSize: 11, color: '#94a3b8' },
  prevueBadge: {
    backgroundColor: 'rgba(26,127,186,0.1)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20,
  },
  prevueBadgeText: { fontSize: 11, fontWeight: '700', color: '#1a7fba' },

  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepperBtn: {
    width: 38, height: 44, borderRadius: 8, alignItems: 'center',
    justifyContent: 'center', backgroundColor: '#f1f4f8',
  },
  stepperBtnText: { fontSize: 22, fontWeight: '700', color: '#0a1628', lineHeight: 26 },
  qteInput: {
    width: 52, height: 44, fontSize: 18, fontWeight: '700', color: '#0a1628',
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 8,
    marginHorizontal: 4, backgroundColor: '#fff', textAlign: 'center',
  },

  // ── Paiement
  label:     { fontSize: 13, fontWeight: '700', color: '#374151' },
  switchSub: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  pickerWrap: {
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10, marginTop: 6,
    overflow: 'hidden', backgroundColor: '#fafbfc',
  },
  montantHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 10,
  },
  toggleLink: { color: '#1a7fba', fontSize: 13, fontWeight: '600' },
  montantInput: {
    borderWidth: 1.5, borderColor: '#1a7fba', borderRadius: 10,
    padding: 12, fontSize: 20, fontWeight: '700', marginTop: 8,
    backgroundColor: 'rgba(26,127,186,0.04)', color: '#0a1628',
  },
  montantAutoRow:  { flexDirection: 'row', alignItems: 'baseline', marginTop: 8, marginBottom: 4 },
  montantAutoValue:{ fontSize: 26, fontWeight: '800', color: '#198754', letterSpacing: -0.5 },
  montantAutoUnit: { fontSize: 14, fontWeight: '700', color: '#198754' },
  montantAutoHint: { fontSize: 12, color: '#94a3b8' },

  // ── Signatures
  nomInput: {
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10,
    padding: 11, marginTop: 6, fontSize: 14, color: '#0a1628', backgroundColor: '#fafbfc',
  },
  sigRow: { flexDirection: 'row', gap: 10 },
  sigButton: {
    flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1.5,
  },
  sigPending: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderStyle: 'dashed' },
  sigDone:    { backgroundColor: 'rgba(25,135,84,0.06)', borderColor: 'rgba(25,135,84,0.4)' },
  sigIcon: { fontSize: 22, marginBottom: 5, color: '#94a3b8' },
  sigButtonLabel: { fontSize: 13, fontWeight: '700', color: '#6c757d' },
  sigButtonLabelDone: { color: '#198754' },
  sigButtonSub: { fontSize: 10, color: '#94a3b8', marginTop: 2, textAlign: 'center' },
  sigButtonSubDone: { color: 'rgba(25,135,84,0.7)' },

  // ── Commentaire
  commentaire: { minHeight: 72, fontSize: 14, color: '#0a1628', lineHeight: 20 },

  // ── Bouton enregistrer
  saveButton: {
    backgroundColor: '#0a1628', marginHorizontal: 12, marginTop: 22, marginBottom: 8,
    paddingVertical: 16, paddingHorizontal: 20, borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#0a1628', shadowOpacity: 0.22, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  saveSub:  { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 },

  // ── Bouton échec
  echecButton: {
    marginHorizontal: 12, marginBottom: 8, paddingVertical: 13, borderRadius: 12,
    alignItems: 'center', borderWidth: 1.5,
    borderColor: 'rgba(220,53,69,0.35)', backgroundColor: 'rgba(220,53,69,0.04)',
  },
  echecButtonText: { color: '#dc3545', fontWeight: '600', fontSize: 13 },
});
