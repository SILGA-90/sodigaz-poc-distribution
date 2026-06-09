/**
 * Ecran de saisie d'une operation (collecte ou restitution).
 * Light thème — header navy, formulaire blanc haute lisibilité terrain.
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
import { Colors } from '../theme';

const NAVY  = '#0a1628';
const BG    = '#f0f4f8';
const CARD  = '#ffffff';
const INPUT = '#f1f5f9';
const BORDER= '#e2e8f0';
const TEXT  = '#0f172a';
const TEXT2 = '#334155';
const TEXT3 = '#64748b';

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
  const [etapeInfo, setEtapeInfo]       = useState<EtapeInfo | null>(null);
  const [lignes, setLignes]             = useState<LigneState[]>([]);
  const [modePaiement, setModePaiement] = useState<ModePaiement>('ESPECES');
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
      Alert.alert('Quitter la saisie ?', 'Les informations saisies seront perdues.',
        [{ text: 'Rester', style: 'cancel' }, { text: 'Quitter', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) }]);
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
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;

  const isCollecte = etapeInfo?.type_programme === 'COLLECTE';
  const gpsColor = gpsStatus === 'fiable' ? Colors.success : gpsStatus === 'degradee' ? Colors.warning : gpsStatus === 'absente' ? Colors.danger : TEXT3;
  const gpsBg    = gpsStatus === 'fiable' ? Colors.successBg : gpsStatus === 'degradee' ? Colors.warningBg : gpsStatus === 'absente' ? Colors.dangerBg : '#f1f5f9';
  const gpsLabel = gpsStatus === 'fiable' ? 'GPS fiable' : gpsStatus === 'degradee' ? 'GPS imprécis' : gpsStatus === 'absente' ? 'GPS absent' : 'GPS…';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* HEADER navy */}
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
      <SectionHeader icon={isCollecte ? '↓' : '↑'} color="blue" title={isCollecte ? 'Bouteilles à collecter' : 'Quantités à livrer'} />
      <View style={styles.card}>
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
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn}
                onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; if (c > 0) updateQuantite(index, String(c - 1)); }}>
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.qteInput}
                value={ligne.quantite}
                onChangeText={(v) => updateQuantite(index, v)}
                keyboardType="number-pad"
                maxLength={4}
                textAlign="center"
              />
              <TouchableOpacity style={styles.stepBtn}
                onPress={() => { const c = parseInt(ligne.quantite, 10) || 0; updateQuantite(index, String(c + 1)); }}>
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* PAIEMENT */}
      {isCollecte ? (
        <>
          <SectionHeader icon="$" color="orange" title="Acompte (optionnel)" />
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <Text style={styles.label}>Le client verse un acompte ?</Text>
              <Switch value={avecAcompte} onValueChange={setAvecAcompte}
                trackColor={{ false: BORDER, true: Colors.brandOrange + '80' }}
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
        </>
      ) : (
        <>
          <SectionHeader icon="$" color="green" title="Paiement" />
          <View style={styles.card}>
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
                trackColor={{ false: BORDER, true: Colors.success + '80' }}
                thumbColor={estEncaissee ? Colors.success : '#94a3b8'} />
            </View>
          </View>
        </>
      )}

      {/* SIGNATURES */}
      <SectionHeader icon="✎" color="navy" title="Signatures" />
      <View style={styles.card}>
        <Text style={styles.label}>Nom du signataire (client)</Text>
        <FieldInput value={nomSignataire} onChangeText={setNomSignataire} placeholder="Nom complet du client" />
        <View style={styles.fieldSep} />
        <View style={styles.sigRow}>
          {(['LIVREUR', 'CLIENT'] as const).map((who) => {
            const signed = who === 'LIVREUR' ? !!signatureLivreur : !!signatureClient;
            return (
              <TouchableOpacity key={who} style={[styles.sigBtn, signed && styles.sigBtnDone]}
                onPress={() => setPadVisible(who)} activeOpacity={0.8}>
                <Text style={[styles.sigIcon, signed && styles.sigIconDone]}>{signed ? '✓' : '✎'}</Text>
                <Text style={[styles.sigLabel, signed && styles.sigLabelDone]}>{who === 'LIVREUR' ? 'Livreur' : 'Client'}</Text>
                <Text style={[styles.sigSub, signed && styles.sigSubDone]}>{signed ? 'Signé' : 'Appuyer pour signer'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* PHOTOS */}
      <SectionHeader icon="▣" color="blue" title="Photos" />
      <View style={styles.cardNoPad}>
        <PhotosSection photos={photos} onChange={setPhotos} cameraOnly />
      </View>

      {/* COMMENTAIRE */}
      <SectionHeader icon="≡" color="gray" title="Commentaire" />
      <View style={styles.card}>
        <TextInput
          style={styles.commentaire}
          value={commentaire}
          onChangeText={(v) => { isDirty.current = true; setCommentaire(v); }}
          multiline
          placeholder="Remarque éventuelle…"
          placeholderTextColor={TEXT3}
          textAlignVertical="top"
        />
      </View>

      {/* BOUTON ENREGISTRER */}
      <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave} disabled={saving} activeOpacity={0.85}>
        {saving ? <ActivityIndicator color="#fff" /> : (
          <>
            <Text style={styles.saveBtnText}>Enregistrer l'opération</Text>
            <Text style={styles.saveBtnSub}>{isCollecte ? 'Collecte' : 'Restitution'}{etapeInfo ? ` · ${etapeInfo.plv_libelle}` : ''}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* BOUTON ÉCHEC */}
      {etapeInfo && (
        <TouchableOpacity
          style={styles.echecBtn}
          disabled={saving}
          onPress={() => Alert.alert('Marquer en échec',
            "Confirmes-tu que cette étape ne peut pas être effectuée ?",
            [{ text: 'Annuler', style: 'cancel' },
             { text: "Confirmer l'échec", style: 'destructive', onPress: async () => {
               try { await marquerEtapeEchec(etapeInfo.uuid); isDirty.current = false; navigation.goBack(); }
               catch (e: any) { Alert.alert('Erreur', e?.message ?? String(e)); }
             }}])}
        >
          <Text style={styles.echecBtnText}>Étape non réalisable → Marquer en échec</Text>
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

// ── Sous-composants ──────────────────────────────────────────────────────────

type IconColor = 'blue' | 'green' | 'orange' | 'navy' | 'gray';
function SectionHeader({ icon, color, title }: { icon: string; color: IconColor; title: string }) {
  const bg: Record<IconColor, string> = { blue: '#e0f2fe', green: '#dcfce7', orange: '#fff7ed', navy: '#f1f5f9', gray: '#f8fafc' };
  const fg: Record<IconColor, string> = { blue: Colors.brandBlue, green: Colors.success, orange: Colors.brandOrange, navy: '#334155', gray: '#64748b' };
  return (
    <View style={shS.row}>
      <View style={[shS.iconBox, { backgroundColor: bg[color] }]}>
        <Text style={[shS.iconText, { color: fg[color] }]}>{icon}</Text>
      </View>
      <Text style={shS.title}>{title}</Text>
    </View>
  );
}
const shS = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 22, marginBottom: 8 },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconText:{ fontSize: 14, fontWeight: '800' },
  title:   { fontSize: 14, fontWeight: '800', color: '#0f172a', letterSpacing: -0.2 },
});

function FieldInput({ value, onChangeText, placeholder, keyboardType }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: any;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[fiS.input, focused && fiS.inputFocused]}
      value={value} onChangeText={onChangeText}
      placeholder={placeholder} placeholderTextColor="#94a3b8"
      keyboardType={keyboardType} autoCorrect={false}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    />
  );
}
const fiS = StyleSheet.create({
  input:        { marginTop: 8, backgroundColor: INPUT, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: TEXT },
  inputFocused: { borderColor: Colors.brandBlue },
});

function FieldPicker({ selectedValue, onValueChange }: { selectedValue: string; onValueChange: (v: string) => void }) {
  return (
    <View style={fpS.wrap}>
      <Picker selectedValue={selectedValue} onValueChange={onValueChange} style={{ color: TEXT }}>
        {MODES_PAIEMENT.map((m) => <Picker.Item key={m.value} label={m.label} value={m.value} />)}
      </Picker>
    </View>
  );
}
const fpS = StyleSheet.create({
  wrap: { marginTop: 8, backgroundColor: INPUT, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, overflow: 'hidden' },
});

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG },

  header: { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1:{ position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -55, right: -40, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2:{ position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 35, right: 100, backgroundColor: 'rgba(7,155,217,0.07)' },
  headerContent: { padding: 16, paddingBottom: 22 },
  headerTopBar:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

  gpsPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  gpsDot:  { width: 7, height: 7, borderRadius: 4 },
  gpsPillText: { fontSize: 12, fontWeight: '700' },

  itineraireBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: Colors.brandBlue },
  itineraireText:{ color: '#fff', fontWeight: '700', fontSize: 12 },

  typeChip: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginBottom: 8, borderWidth: 1 },
  typeChipC:{ backgroundColor: 'rgba(7,155,217,0.2)', borderColor: 'rgba(7,155,217,0.4)' },
  typeChipR:{ backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  plvName:    { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  clientName: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 3 },

  card: { backgroundColor: CARD, marginHorizontal: 12, marginBottom: 4, borderRadius: 14, padding: 14, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  cardNoPad: { backgroundColor: CARD, marginHorizontal: 12, marginBottom: 4, borderRadius: 14, overflow: 'hidden', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  fieldSep: { height: 1, backgroundColor: BORDER, marginVertical: 12 },

  ligneRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  ligneRowSep: { borderTopWidth: 1, borderTopColor: BORDER },
  produitLibelle: { fontSize: 14, fontWeight: '700', color: TEXT },
  produitMeta:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  codeBadge:      { backgroundColor: INPUT, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  codeBadgeText:  { fontSize: 11, fontWeight: '600', color: TEXT3 },
  produitPrix:    { fontSize: 11, color: TEXT3 },
  prevueBadge:    { backgroundColor: Colors.infoBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  prevueBadgeText:{ fontSize: 11, fontWeight: '700', color: Colors.brandBlue },

  stepper:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn:    { width: 40, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  stepBtnText:{ fontSize: 22, fontWeight: '700', color: TEXT, lineHeight: 26 },
  qteInput:   { width: 52, height: 44, borderRadius: 10, backgroundColor: INPUT, borderWidth: 1.5, borderColor: BORDER, fontSize: 18, fontWeight: '700', color: TEXT, textAlign: 'center' },

  label:     { fontSize: 13, fontWeight: '700', color: TEXT2, marginTop: 2 },
  switchSub: { fontSize: 11, color: TEXT3, marginTop: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  montantHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  toggleLink: { color: Colors.brandBlue, fontSize: 13, fontWeight: '600' },
  montantAutoRow:   { flexDirection: 'row', alignItems: 'baseline', marginTop: 8, marginBottom: 4 },
  montantAutoValue: { fontSize: 26, fontWeight: '800', color: Colors.success, letterSpacing: -0.5 },
  montantAutoUnit:  { fontSize: 14, fontWeight: '700', color: Colors.success },
  montantAutoHint:  { fontSize: 12, color: TEXT3 },

  sigRow: { flexDirection: 'row', gap: 10 },
  sigBtn: { flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', backgroundColor: INPUT, borderWidth: 1.5, borderColor: BORDER },
  sigBtnDone: { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  sigIcon:     { fontSize: 22, marginBottom: 5, color: TEXT3 },
  sigIconDone: { color: Colors.success },
  sigLabel:    { fontSize: 13, fontWeight: '700', color: TEXT2 },
  sigLabelDone:{ color: Colors.success },
  sigSub:      { fontSize: 10, color: TEXT3, marginTop: 2, textAlign: 'center' },
  sigSubDone:  { color: Colors.success },

  commentaire: { minHeight: 80, fontSize: 14, color: TEXT, lineHeight: 20, backgroundColor: INPUT, borderRadius: 10, padding: 12, borderWidth: 1.5, borderColor: BORDER },

  saveBtn: { backgroundColor: Colors.brandOrange, marginHorizontal: 12, marginTop: 22, marginBottom: 8, borderRadius: 14, paddingVertical: 17, paddingHorizontal: 20, alignItems: 'center', shadowColor: Colors.brandOrange, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 7 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  saveBtnSub:  { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 },

  echecBtn: { marginHorizontal: 12, marginBottom: 8, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.dangerBg, borderWidth: 1.5, borderColor: Colors.dangerBorder },
  echecBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 13 },
});
