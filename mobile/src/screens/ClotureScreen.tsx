/**
 * Écran de clôture d'un programme : récapitulatif + confirmation.
 *
 * Affiche un récapitulatif complet du programme avant clôture :
 * étapes visitées / total, montant encaissé, opérations, anomalies.
 * Après confirmation, appelle cloturerProgrammeLocal() qui marque le
 * programme CLOTURE localement et inscrit l'UUID dans la file d'attente
 * (sync_meta). La confirmation serveur se fera au prochain syncAll().
 *
 * Le livreur peut ne pas avoir
 * de réseau à la fin de sa tournée. La clôture locale est immédiate et
 * ne bloque pas le retour au dépôt. La file clotures_pending garantit
 * que la clôture sera remontée au serveur dès que le réseau revient,
 * avant le prochain pull (pour éviter que le pull écrase le statut CLOTURE).
 * Voir syncService.ts : pushClotures -> pull -> push.
 *
 * WHY (navigation.navigate('Dashboard') après clôture) : On retourne au tableau
 * de bord plutôt que goBack(). Si l'utilisateur a navigué profondément
 * (Dashboard -> Programme -> Cloture), goBack() retournerait à ProgrammeScreen
 * qui afficherait un programme clôturé : confusant. navigate('Dashboard')
 * nettoie la pile et retourne à l'accueil directement.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  getProgrammeById,
  getRecapProgramme,
  getOperationsRecapProgramme,
  getLignesOperationsRecap,
  cloturerProgrammeLocal,
  RecapProgramme,
  OperationRecap,
  LigneOperationRecap,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';
import { Colors, scale } from '../theme';
import { neoCard, NEO, NEO_SHD, NAVY, TEXT, TEXT2, TEXT3, SEP } from '../components/saisie/neoStyles';
import SectionHeader from '../components/saisie/SectionHeader';
import RecapRow from '../components/saisie/RecapRow';
import NeoDialog from '../components/NeoDialog';

type Props = NativeStackScreenProps<RootStackParamList, 'Cloture'>;

export default function ClotureScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const { width } = useWindowDimensions();
  const [programme,   setProgramme]   = useState<Programme | null>(null);
  const [recap,       setRecap]       = useState<RecapProgramme | null>(null);
  const [operations,  setOperations]  = useState<OperationRecap[]>([]);
  const [lignesMap,   setLignesMap]   = useState<Record<string, LigneOperationRecap[]>>({});
  const [loading,     setLoading]     = useState(true);
  const [closing,     setClosing]     = useState(false);
  const [clotureReussie, setClotureReussie] = useState(false);
  const [showClotureDialog, setShowClotureDialog] = useState(false);
  const [clotureDialogMsg, setClotureDialogMsg]   = useState('');
  const [showErrorDialog, setShowErrorDialog]     = useState(false);
  const [errorMsg, setErrorMsg]                   = useState('');

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      if (p) {
        const [r, ops, lignes] = await Promise.all([
          getRecapProgramme(programmeId, p.uuid),
          getOperationsRecapProgramme(programmeId),
          getLignesOperationsRecap(programmeId),
        ]);
        setProgramme(p);
        setRecap(r);
        setOperations(ops);
        const map: Record<string, LigneOperationRecap[]> = {};
        for (const l of lignes) {
          if (!map[l.operation_uuid]) map[l.operation_uuid] = [];
          map[l.operation_uuid].push(l);
        }
        setLignesMap(map);
      }
      setLoading(false);
    })();
  }, [programmeId]);

  function confirmerCloture(): void {
    if (!programme || !recap) return;
    const reste = recap.total_etapes - recap.etapes_visitees;
    const message = reste > 0
      ? `Attention : ${reste} étape(s) non visitée(s). Clôturer quand même ?`
      : 'Toutes les étapes sont visitées. Confirmer la clôture ?';
    setClotureDialogMsg(message);
    setShowClotureDialog(true);
  }

  async function faireCloture(): Promise<void> {
    if (!programme) return;
    setClosing(true);
    try {
      await cloturerProgrammeLocal(programme.uuid);
      setClotureReussie(true);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setShowErrorDialog(true);
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;
  }

  if (!programme || !recap) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Programme introuvable.</Text>
      </View>
    );
  }

  /* État clôture réussie */
  if (clotureReussie) {
    const pct = recap.total_etapes > 0
      ? Math.round((recap.etapes_visitees / recap.total_etapes) * 100) : 0;
    return (
      <View style={styles.successRoot}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />

        {/* Grande icône raised ✓ */}
        <View style={styles.checkOuter}>
          <View style={styles.checkInner}>
            <Ionicons name="checkmark-circle" size={56} color={Colors.success} />
          </View>
        </View>
        <Text style={styles.successTitle}>Tournée terminée</Text>
        <Text style={styles.successSub}>{programme.numero_x3} · {programme.date_programme}</Text>

        {/* Bilan */}
        <View style={[neoCard.outer, { width: '100%' }]}>
          <View style={neoCard.inner}>
            <Text style={styles.cardTitle}>Bilan de la tournée</Text>
            <RecapRow label="Étapes visitées"
              value={`${recap.etapes_visitees} / ${recap.total_etapes} (${pct} %)`} />
            {recap.etapes_echec > 0 && (
              <RecapRow label="Étapes en échec" value={String(recap.etapes_echec)} danger />
            )}
            <RecapRow label="Opérations réalisées" value={String(recap.nb_operations)} />
            {recap.montant_total > 0 && (
              <RecapRow label="Montant total"
                value={`${recap.montant_total.toLocaleString('fr-FR')} FCFA`} />
            )}
            <RecapRow label="Montant encaissé"
              value={`${recap.montant_encaisse.toLocaleString('fr-FR')} FCFA`} success />
            {recap.montant_total > recap.montant_encaisse && (
              <RecapRow label="Non encaissé"
                value={`${(recap.montant_total - recap.montant_encaisse).toLocaleString('fr-FR')} FCFA`}
                warning />
            )}
            {recap.nb_anomalies > 0 && (
              <RecapRow label="Anomalies signalées" value={String(recap.nb_anomalies)} warning />
            )}
          </View>
        </View>

        {/* Avertissement sync */}
        <View style={styles.syncNoticeOuter}>
          <View style={styles.syncNoticeInner}>
            <Ionicons name="cloud-upload-outline" size={18} color={Colors.warning} />
            <Text style={styles.syncNoticeText}>
              Synchronisez dès que possible pour remonter vos données au superviseur.
            </Text>
          </View>
        </View>

        {/* Bouton retour : raised bleu */}
        <View style={styles.backBtnOuter}>
          <TouchableOpacity style={styles.backBtnInner}
            onPress={() => navigation.navigate('Dashboard')} activeOpacity={0.85}>
            <Text style={styles.backBtnText}>Retour au tableau de bord</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* Vue principale */
  const dejaCloture = programme.statut === 'CLOTURE';
  const isCollecte  = programme.type_programme === 'COLLECTE';

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, width >= 700 && styles.wideContent]}>

      {/* Header navy */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <View style={[styles.typeChip, isCollecte ? styles.typeChipC : styles.typeChipR]}>
            <Text style={styles.typeChipText}>{isCollecte ? 'Collecte' : 'Restitution'}</Text>
          </View>
          <Text style={styles.numero}>{programme.numero_x3}</Text>
          <Text style={styles.meta}>{programme.date_programme}</Text>
        </View>
      </View>

      {/* RÉCAPITULATIF */}
      <SectionHeader icon="list-outline" color="blue" title="Récapitulatif de la tournée" />
      <View style={neoCard.outer}>
        <View style={neoCard.inner}>

          {/* Barre de progression */}
          {(() => {
            const pct = recap.total_etapes > 0
              ? Math.round((recap.etapes_visitees / recap.total_etapes) * 100) : 0;
            const restantes = recap.total_etapes - recap.etapes_visitees - recap.etapes_echec;
            return (
              <>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>Progression</Text>
                  <Text style={styles.progressPct}>{pct} %</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` as any,
                    backgroundColor: pct === 100 ? Colors.success : Colors.brandBlue }]} />
                </View>
                <View style={styles.etapesRow}>
                  <View style={styles.etapeStat}>
                    <Text style={[styles.etapeStatN, { color: Colors.success }]}>{recap.etapes_visitees}</Text>
                    <Text style={styles.etapeStatL}>Visitées</Text>
                  </View>
                  {recap.etapes_echec > 0 && (
                    <View style={styles.etapeStat}>
                      <Text style={[styles.etapeStatN, { color: Colors.danger }]}>{recap.etapes_echec}</Text>
                      <Text style={styles.etapeStatL}>Échec</Text>
                    </View>
                  )}
                  {restantes > 0 && (
                    <View style={styles.etapeStat}>
                      <Text style={[styles.etapeStatN, { color: Colors.warning }]}>{restantes}</Text>
                      <Text style={styles.etapeStatL}>Restantes</Text>
                    </View>
                  )}
                  <View style={styles.etapeStat}>
                    <Text style={[styles.etapeStatN, { color: TEXT2 }]}>{recap.total_etapes}</Text>
                    <Text style={styles.etapeStatL}>Total</Text>
                  </View>
                </View>
              </>
            );
          })()}

          <View style={styles.recapDivider} />

          <RecapRow label="Opérations réalisées" value={String(recap.nb_operations)} />
          {recap.montant_total > 0 && (
            <RecapRow label="Montant total"
              value={`${recap.montant_total.toLocaleString('fr-FR')} FCFA`} />
          )}
          <RecapRow label="Montant encaissé"
            value={`${recap.montant_encaisse.toLocaleString('fr-FR')} FCFA`} success />
          {recap.montant_total > recap.montant_encaisse && (
            <RecapRow label="Non encaissé"
              value={`${(recap.montant_total - recap.montant_encaisse).toLocaleString('fr-FR')} FCFA`}
              warning />
          )}
          {recap.nb_anomalies > 0 && (
            <RecapRow label="Anomalies signalées" value={String(recap.nb_anomalies)} warning />
          )}
        </View>
      </View>

      {/* DÉTAIL DES OPÉRATIONS */}
      {operations.length > 0 && (
        <>
          <SectionHeader icon="receipt-outline" color="blue" title="Détail des opérations" />
          {operations.map((op, i) => {
            const heure = op.date_heure ? op.date_heure.slice(11, 16) : '';
            const encaissee = Boolean(op.est_encaissee);
            const isCollecteOp = op.type_operation === 'COLLECTE';
            const typeColor = isCollecteOp ? Colors.brandBlue : Colors.success;
            const typeBg    = isCollecteOp ? '#e3f3fb' : Colors.successBg;
            const paiementLabel = op.mode_paiement === 'MOBILE_MONEY' ? 'Mobile Money'
              : op.mode_paiement === 'CHEQUE' ? 'Chèque'
              : op.mode_paiement === 'VIREMENT' ? 'Virement'
              : op.mode_paiement === 'ESPECES' ? 'Espèces'
              : op.mode_paiement ?? '—';
            return (
              <View key={i} style={[neoCard.outer, { marginBottom: 10 }]}>
                <View style={neoCard.inner}>
                  {/* Ligne 1 : heure + type */}
                  <View style={styles.opCardTop}>
                    <View style={[styles.opTypeChip, { backgroundColor: typeBg, borderColor: typeColor + '40' }]}>
                      <View style={[styles.opTypeDot, { backgroundColor: typeColor }]} />
                      <Text style={[styles.opTypeLabel, { color: typeColor }]}>
                        {isCollecteOp ? 'Collecte' : 'Restitution'}
                      </Text>
                    </View>
                    {heure ? <Text style={styles.opHeure}>{heure}</Text> : null}
                  </View>
                  {/* Client */}
                  <Text style={styles.opClientName} numberOfLines={1}>{op.client_raison_sociale}</Text>
                  {/* PLV */}
                  {op.plv_code ? (
                    <View style={styles.opPlvRow}>
                      <Ionicons name="storefront-outline" size={12} color={TEXT3} />
                      <View style={styles.opPlvCodeChip}>
                        <Text style={styles.opPlvCode}>{op.plv_code}</Text>
                      </View>
                    </View>
                  ) : null}
                  {op.plv_adresse ? (
                    <View style={styles.opAdresseRow}>
                      <Ionicons name="location-outline" size={11} color={TEXT3} />
                      <Text style={styles.opAdresse} numberOfLines={1}>{op.plv_adresse}</Text>
                    </View>
                  ) : null}
                  {/* Articles saisis */}
                  {(lignesMap[op.operation_uuid] ?? []).map((l, j) => (
                    <View key={j} style={styles.ligneRow}>
                      <Text style={styles.ligneLibelle} numberOfLines={1}>{l.libelle}</Text>
                      <View style={styles.ligneRight}>
                        <Text style={styles.ligneQte}>× {l.quantite_realisee}</Text>
                        {l.montant_ligne > 0 && (
                          <Text style={styles.ligneMontant}>{l.montant_ligne.toLocaleString('fr-FR')} FCFA</Text>
                        )}
                      </View>
                    </View>
                  ))}

                  {/* Ligne 3 : paiement */}
                  {op.mode_paiement && (
                    <View style={styles.opCardMid}>
                      <Text style={styles.opMeta}>{paiementLabel}</Text>
                    </View>
                  )}
                  {/* Séparateur */}
                  <View style={styles.opDivider} />
                  {/* Ligne 4 : montant + encaissement */}
                  <View style={styles.opCardBottom}>
                    <Text style={styles.opMontant}>{op.montant_total.toLocaleString('fr-FR')} FCFA</Text>
                    <View style={[styles.opEncaissePill, { backgroundColor: encaissee ? Colors.successBg : Colors.dangerBg }]}>
                      <Ionicons
                        name={encaissee ? 'checkmark-circle' : 'close-circle'}
                        size={12}
                        color={encaissee ? Colors.success : Colors.danger}
                      />
                      <Text style={[styles.opEncaisseText, { color: encaissee ? Colors.success : Colors.danger }]}>
                        {encaissee ? 'Encaissé' : 'Non encaissé'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </>
      )}

      {/* ACTION */}
      {dejaCloture ? (
        /* Badge déjà clôturé : raised vert */
        <View style={styles.clotureBadgeOuter}>
          <View style={styles.clotureBadgeInner}>
            <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
            <Text style={styles.clotureBadgeText}>Programme déjà clôturé</Text>
          </View>
        </View>
      ) : (
        /* Bouton clôturer : raised vert */
        <View style={[styles.clotureBtnOuter, closing && { opacity: 0.5 }]}>
          <TouchableOpacity style={styles.clotureBtnInner}
            onPress={confirmerCloture} disabled={closing} activeOpacity={0.85}>
            {closing ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={styles.clotureBtnText}>Clôturer le programme</Text>
                <Text style={styles.clotureBtnSub}>Action irréversible</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      <NeoDialog
        visible={showClotureDialog}
        icon="warning-outline" iconColor={Colors.danger}
        title="Clôturer le programme"
        message={clotureDialogMsg}
        confirmLabel="Clôturer" cancelLabel="Annuler"
        danger
        loading={closing}
        onCancel={() => setShowClotureDialog(false)}
        onConfirm={() => { setShowClotureDialog(false); faireCloture(); }}
      />
      <NeoDialog
        visible={showErrorDialog}
        icon="alert-circle-outline" iconColor={Colors.danger}
        title="Erreur"
        message={errorMsg}
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
  scroll:      { paddingBottom: 40 },
  wideContent: { maxWidth: 700, alignSelf: 'center', width: '100%' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO, padding: 32 },
  errorText: { color: TEXT3, fontSize: scale(15) },

  /* Header navy */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 30,  right: 110, backgroundColor: 'rgba(7,155,217,0.07)' },
  headerContent: { padding: 16, paddingBottom: 22 },
  typeChip:  { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginBottom: 8, borderWidth: 1 },
  typeChipC: { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  typeChipR: { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: scale(11), fontWeight: '700', color: '#e2e8f0' },
  numero: { fontSize: scale(22), fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  meta:   { fontSize: scale(13), color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  cardTitle: { fontSize: scale(15), fontWeight: '700', color: TEXT2, marginBottom: 8 },

  /* Barre de progression */
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressLabel:  { fontSize: scale(13), fontWeight: '600', color: TEXT2 },
  progressPct:    { fontSize: scale(14), fontWeight: '800', color: Colors.brandBlue },
  progressTrack:  { height: 8, borderRadius: 4, backgroundColor: '#d4dde6', marginBottom: 14, overflow: 'hidden' },
  progressFill:   { height: 8, borderRadius: 4 },

  /* Mini stats étapes */
  etapesRow:   { flexDirection: 'row', gap: 12, marginBottom: 4 },
  etapeStat:   { alignItems: 'center', flex: 1 },
  etapeStatN:  { fontSize: scale(20), fontWeight: '800', letterSpacing: -0.5 },
  etapeStatL:  { fontSize: scale(10), color: TEXT3, marginTop: 1, fontWeight: '600' },

  recapDivider: { height: 1, backgroundColor: SEP, marginVertical: 14 },

  /* Cartes opérations */
  opCardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  opTypeChip:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  opTypeDot:    { width: 6, height: 6, borderRadius: 3 },
  opTypeLabel:  { fontSize: scale(11), fontWeight: '700' },
  opHeure:      { fontSize: scale(12), fontWeight: '600', color: TEXT3 },
  opClientName: { fontSize: scale(14), fontWeight: '700', color: TEXT, marginBottom: 4 },
  opPlvRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  opPlvCodeChip:  { backgroundColor: '#e3f3fb', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(7,155,217,0.3)' },
  opPlvCode:      { fontSize: scale(10), fontWeight: '800', color: Colors.brandBlue },
  opAdresseRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  opAdresse:    { fontSize: scale(11), color: TEXT3, flex: 1 },
  /* Lignes d'articles */
  ligneRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: SEP },
  ligneLibelle: { flex: 1, fontSize: scale(13), color: TEXT, fontWeight: '600', marginRight: 8 },
  ligneRight:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ligneQte:     { fontSize: scale(13), fontWeight: '800', color: Colors.brandBlue },
  ligneMontant: { fontSize: scale(12), color: TEXT3 },

  opCardMid:    { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 10 },
  opMeta:       { fontSize: scale(12), color: TEXT2, fontWeight: '600' },
  opDivider:    { height: 1, backgroundColor: SEP, marginBottom: 10 },
  opCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  opMontant:    { fontSize: scale(16), fontWeight: '800', color: TEXT },
  opEncaissePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  opEncaisseText: { fontSize: scale(11), fontWeight: '700' },

  /* Badge "déjà clôturé" : raised vert */
  clotureBadgeOuter: {
    marginHorizontal: 12, marginTop: 20,
    borderRadius: 12, backgroundColor: Colors.successBg,
    shadowColor: '#107a30', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  clotureBadgeInner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, backgroundColor: Colors.successBg, padding: 16, justifyContent: 'center',
    shadowColor: '#d0fff0', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.7, shadowRadius: 5,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#d0fff0', borderLeftColor: '#d0fff0',
    borderBottomColor: Colors.successBorder, borderRightColor: Colors.successBorder,
  },
  clotureBadgeText: { color: Colors.success, fontWeight: '700', fontSize: scale(14) },

  /* Bouton clôturer : raised vert */
  clotureBtnOuter: {
    marginHorizontal: 12, marginTop: 22, marginBottom: 8,
    borderRadius: 14, backgroundColor: Colors.success,
    shadowColor: '#065f46', shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.7, shadowRadius: 10, elevation: 10,
  },
  clotureBtnInner: {
    borderRadius: 14, backgroundColor: Colors.success,
    paddingVertical: 17, alignItems: 'center',
    shadowColor: '#6ee7b7', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.5, shadowRadius: 8,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#6ee7b7', borderLeftColor: '#6ee7b7',
    borderBottomColor: '#065f46', borderRightColor: '#065f46',
  },
  clotureBtnText: { color: '#fff', fontSize: scale(16), fontWeight: '800', letterSpacing: -0.2 },
  clotureBtnSub:  { color: 'rgba(255,255,255,0.65)', fontSize: scale(11), marginTop: 4 },

  /* État succès */
  successRoot: { flex: 1, backgroundColor: NEO, padding: 24, alignItems: 'center', justifyContent: 'center' },

  checkOuter: {
    borderRadius: 50, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 10, elevation: 10,
    marginBottom: 20,
  },
  checkInner: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.successBg,
    shadowColor: '#ffffff', shadowOffset: { width: -5, height: -5 }, shadowOpacity: 1, shadowRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#d0fff0', borderLeftColor: '#d0fff0',
    borderBottomColor: Colors.successBorder, borderRightColor: Colors.successBorder,
  },

  successTitle: { fontSize: scale(24), fontWeight: '800', color: TEXT, letterSpacing: -0.5, marginBottom: 4 },
  successSub:   { fontSize: scale(13), color: TEXT3, marginBottom: 28 },

  /* Notice sync : warning raised */
  syncNoticeOuter: {
    width: '100%', marginBottom: 14,
    borderRadius: 12, backgroundColor: Colors.warningBg,
    shadowColor: '#92400e', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  syncNoticeInner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 12, backgroundColor: Colors.warningBg, padding: 14,
    shadowColor: '#fffdf0', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.8, shadowRadius: 5,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#fffdf0', borderLeftColor: '#fffdf0',
    borderBottomColor: Colors.warningBorder, borderRightColor: Colors.warningBorder,
  },
  syncNoticeText: { flex: 1, fontSize: scale(13), color: TEXT2, lineHeight: 18 },

  /* Bouton retour : raised bleu */
  backBtnOuter: {
    width: '100%', marginTop: 8,
    borderRadius: 14, backgroundColor: Colors.brandBlue,
    shadowColor: '#046a96', shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.7, shadowRadius: 10, elevation: 10,
  },
  backBtnInner: {
    borderRadius: 14, backgroundColor: Colors.brandBlue,
    paddingVertical: 17, alignItems: 'center',
    shadowColor: '#7dd3fa', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.45, shadowRadius: 8,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#2bb8ef', borderLeftColor: '#2bb8ef',
    borderBottomColor: '#046a96', borderRightColor: '#046a96',
  },
  backBtnText: { color: '#fff', fontSize: scale(16), fontWeight: '700' },
});
