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
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  getProgrammeById,
  getRecapProgramme,
  getOperationsRecapProgramme,
  cloturerProgrammeLocal,
  RecapProgramme,
  OperationRecap,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';
import { neoCard, NEO, NEO_SHD, NAVY, TEXT, TEXT2, TEXT3, SEP } from '../components/saisie/neoStyles';
import SectionHeader from '../components/saisie/SectionHeader';
import RecapRow from '../components/saisie/RecapRow';

type Props = NativeStackScreenProps<RootStackParamList, 'Cloture'>;

export default function ClotureScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme,   setProgramme]   = useState<Programme | null>(null);
  const [recap,       setRecap]       = useState<RecapProgramme | null>(null);
  const [operations,  setOperations]  = useState<OperationRecap[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [closing,     setClosing]     = useState(false);
  const [clotureReussie, setClotureReussie] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getProgrammeById(programmeId);
      if (p) {
        const [r, ops] = await Promise.all([
          getRecapProgramme(programmeId, p.uuid),
          getOperationsRecapProgramme(programmeId),
        ]);
        setProgramme(p);
        setRecap(r);
        setOperations(ops);
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
    Alert.alert('Clôturer le programme', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Clôturer', style: 'destructive', onPress: faireCloture },
    ]);
  }

  async function faireCloture(): Promise<void> {
    if (!programme) return;
    setClosing(true);
    try {
      await cloturerProgrammeLocal(programme.uuid);
      setClotureReussie(true);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
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
            <RecapRow label="Montant encaissé"
              value={`${recap.montant_encaisse.toLocaleString('fr-FR')} FCFA`} success />
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
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

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
          <RecapRow label="Étapes visitées" value={`${recap.etapes_visitees} / ${recap.total_etapes}`} />
          {recap.etapes_echec > 0 && (
            <RecapRow label="Étapes en échec" value={String(recap.etapes_echec)} danger />
          )}
          <RecapRow label="Opérations réalisées" value={String(recap.nb_operations)} />
          <RecapRow label="Montant encaissé"
            value={`${recap.montant_encaisse.toLocaleString('fr-FR')} FCFA`} success />
          {recap.nb_anomalies > 0 && (
            <RecapRow label="Anomalies signalées" value={String(recap.nb_anomalies)} warning />
          )}
        </View>
      </View>

      {/* DÉTAIL DES OPÉRATIONS */}
      {operations.length > 0 && (
        <>
          <SectionHeader icon="receipt-outline" color="blue" title="Détail des opérations" />
          <View style={neoCard.outer}>
            <View style={neoCard.inner}>
              {operations.map((op, i) => (
                <View key={i} style={[styles.opRow, i > 0 && styles.opRowSep]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.opPlv}>{op.plv_libelle}</Text>
                    <Text style={styles.opType}>
                      {op.type_operation === 'COLLECTE' ? 'Collecte' : 'Restitution'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.opMontant}>{op.montant_total.toLocaleString('fr-FR')} FCFA</Text>
                    <Text style={[styles.opEncaisse, { color: op.est_encaissee ? Colors.success : Colors.danger }]}>
                      {op.est_encaissee ? 'Encaissé' : 'Non encaissé'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
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

    </ScrollView>
  );
}

/* Styles */
const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: NEO },
  scroll:    { paddingBottom: 40 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO, padding: 32 },
  errorText: { color: TEXT3, fontSize: 15 },

  /* Header navy */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -60, right: -50, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 30,  right: 110, backgroundColor: 'rgba(7,155,217,0.07)' },
  headerContent: { padding: 16, paddingBottom: 22 },
  typeChip:  { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginBottom: 8, borderWidth: 1 },
  typeChipC: { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  typeChipR: { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  numero: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  meta:   { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  cardTitle: { fontSize: 15, fontWeight: '700', color: TEXT2, marginBottom: 8 },

  /* Lignes opérations */
  opRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 11 },
  opRowSep:  { borderTopWidth: 1, borderTopColor: SEP },
  opPlv:     { fontSize: 13, fontWeight: '700', color: TEXT },
  opType:    { fontSize: 11, color: TEXT3, marginTop: 2 },
  opMontant: { fontSize: 14, fontWeight: '700', color: TEXT },
  opEncaisse:{ fontSize: 11, marginTop: 2 },

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
  clotureBadgeText: { color: Colors.success, fontWeight: '700', fontSize: 14 },

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
  clotureBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  clotureBtnSub:  { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 4 },

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

  successTitle: { fontSize: 24, fontWeight: '800', color: TEXT, letterSpacing: -0.5, marginBottom: 4 },
  successSub:   { fontSize: 13, color: TEXT3, marginBottom: 28 },

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
  syncNoticeText: { flex: 1, fontSize: 13, color: TEXT2, lineHeight: 18 },

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
  backBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
