/**
 * Écran Debug BDD : inspection de la base SQLite locale.
 *
 * Cet écran est accessible uniquement après déblocage par 7 taps +
 * PIN serveur (vérification via /api/auth/dev-access/). Il affiche :
 *          - Le nombre de lignes de chaque table SQLite locale
 *          - La date du dernier pull réussi (lastPulledAt)
 *          - Le nombre d'enregistrements PENDING (non synchronisés)
 *          - Un bouton "Réinitialiser" pour vider toute la base (debug only)
 *
 * Permettre
 * à un livreur de réinitialiser la base effacerait les données PENDING
 * non synchronisées : fraude possible ou perte de données de livraison.
 * Le double verrou (7 taps + PIN serveur) protège contre l'accès
 * accidentel et contre la curiosité non autorisée. Le PIN n'est jamais
 * stocké dans l'app (voir CLAUDE.md §5).
 *
 * En développement, il faut souvent
 * tester un premier pull depuis zéro sans désinstaller l'app. Ce bouton
 * reproduit un état "fresh install" instantanément. Il est explicitement
 * labellisé "Action irréversible · données PENDING perdues" dans le dialog
 * NeoDialog pour que le développeur comprenne ce qu'il fait.
 *
 * Alert.alert() Android ne bloque
 * pas le thread de rendu : un double-tap rapide peut déclencher deux
 * resets. NeoDialog est modal et désactive le bouton Confirmer pendant
 * l'opération (prop loading).
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getDatabase, resetDatabase, getLastPulledAt } from '../db/database';
import { getTableCounts, TableCounts } from '../db/repositories/debugRepository';
import { countPending } from '../db/repositories/operationRepository';
import { RootStackParamList } from '../types/navigation';
import { Colors, scale } from '../theme';
import NeoDialog from '../components/NeoDialog';

/* Palette */
const NEO    = '#F2F4F6';
const NEO_IN = '#E8EEF2';
const NAVY   = '#0a1628';
const TEXT2  = '#3a5060';
const TEXT3  = '#5a7080';
const SEP    = '#DDE2E6';

type Props = NativeStackScreenProps<RootStackParamList, 'Debug'>;

export default function DebugScreen({ navigation }: Props): React.ReactElement {
  const [counts, setCounts]   = useState<TableCounts | null>(null);
  const [lastPull, setLastPull] = useState<number>(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [pending, setPending]   = useState<number>(0);
  const [showResetDialog, setShowResetDialog] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await getDatabase();
      const c  = await getTableCounts();
      const lp = await getLastPulledAt();
      const p  = await countPending();
      setCounts(c);
      setLastPull(lp);
      setPending(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />

      {/* Header navy */}
      <View style={styles.header}>
        <View style={styles.hBubble1} pointerEvents="none" />
        <View style={styles.hBubble2} pointerEvents="none" />

        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <View style={styles.headerIconBox}>
              <Ionicons name="server-outline" size={20} color={Colors.brandBlue} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Base de données</Text>
              <Text style={styles.headerSub}>SQLite · Debug</Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

        {/* Chargement */}
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={Colors.brandBlue} />
            <Text style={styles.loadingText}>Lecture en cours...</Text>
          </View>
        )}

        {/* Erreur */}
        {error && (
          <View style={styles.bannerDanger}>
            <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} style={{ marginTop: 1 }} />
            <Text style={styles.bannerDangerText}>{error}</Text>
          </View>
        )}

        {counts && !loading && (
          <>
            {/* Succès */}
            <View style={styles.bannerSuccess}>
              <Ionicons name="checkmark-circle-outline" size={18} color={Colors.success} style={{ marginTop: 1 }} />
              <Text style={styles.bannerSuccessText}>Base initialisée correctement.</Text>
            </View>

            {/* Table des lignes */}
            <View style={styles.card}>
              <View style={styles.tableHead}>
                <Text style={styles.tableHeadText}>TABLE</Text>
                <Text style={styles.tableHeadText}>LIGNES</Text>
              </View>
              {Object.entries(counts).map(([table, n], i) => {
                const hasRows = (n as number) > 0;
                const isLast  = i === Object.entries(counts).length - 1;
                return (
                  <View key={table} style={[styles.tableRow, !isLast && styles.tableRowSep]}>
                    <Text style={styles.tableName}>{table}</Text>
                    <View style={[styles.countBadge, hasRows && styles.countBadgeActive]}>
                      <Text style={[styles.countText, hasRows && styles.countTextActive]}>
                        {String(n)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Dernière sync */}
            <Text style={styles.meta}>
              Dernière sync : {lastPull === 0 ? 'jamais' : new Date(lastPull).toLocaleString('fr-FR')}
            </Text>
          </>
        )}

        {/* Pending */}
        {!loading && (
          <View style={[styles.pendingBanner, pending > 0 ? styles.pendingWarn : styles.pendingOk]}>
            <Ionicons
              name={pending > 0 ? 'cloud-upload-outline' : 'checkmark-circle-outline'}
              size={20}
              color={pending > 0 ? Colors.warning : Colors.success}
            />
            <Text style={[styles.pendingText, pending > 0 ? styles.pendingTextWarn : styles.pendingTextOk]}>
              {pending > 0
                ? `${pending} enregistrement(s) en attente de synchronisation`
                : 'Aucun enregistrement PENDING'}
            </Text>
          </View>
        )}

        {/* Bouton Rafraîchir */}
        <TouchableOpacity style={styles.refreshBtn} onPress={refresh} disabled={loading} activeOpacity={0.82}>
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Ionicons name="refresh-outline" size={17} color="#fff" />
                <Text style={styles.refreshText}>Rafraîchir</Text>
              </>
          }
        </TouchableOpacity>

        {/* Bouton Réinitialiser */}
        <TouchableOpacity style={styles.resetBtn} onPress={() => setShowResetDialog(true)} activeOpacity={0.85}>
          <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          <View>
            <Text style={styles.resetText}>Réinitialiser la base (debug)</Text>
            <Text style={styles.resetSub}>Action irréversible · données PENDING perdues</Text>
          </View>
        </TouchableOpacity>

        {/* Dialog confirmation reset */}
        <NeoDialog
          visible={showResetDialog}
          icon="warning-outline"
          iconColor={Colors.danger}
          title="Réinitialiser la base ?"
          message={`Cette action supprime toutes les données locales (référentiels, programmes, opérations, photos).\n\nLes enregistrements PENDING non synchronisés seront perdus définitivement.\n\nPending actuels : ${pending}`}
          confirmLabel="Réinitialiser"
          cancelLabel="Annuler"
          danger
          onCancel={() => setShowResetDialog(false)}
          onConfirm={async () => {
            setShowResetDialog(false);
            setLoading(true);
            try { await resetDatabase(); await refresh(); }
            catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
          }}
        />

      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  /* Header navy */
  header: {
    backgroundColor: NAVY,
    paddingTop: 48, paddingBottom: 18, paddingHorizontal: 16,
    overflow: 'hidden',
  },
  hBubble1: {
    position: 'absolute', borderRadius: 999,
    width: 200, height: 200, top: -60, right: -50,
    backgroundColor: 'rgba(7,155,217,0.1)',
  },
  hBubble2: {
    position: 'absolute', borderRadius: 999,
    width: 100, height: 100, bottom: -30, left: -20,
    backgroundColor: 'rgba(238,114,2,0.07)',
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerIconBox: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(7,155,217,0.15)',
    borderWidth: 1, borderColor: 'rgba(7,155,217,0.3)',
  },
  headerTitle: { fontSize: scale(16), fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
  headerSub:   { fontSize: scale(11), color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginTop: 1 },

  /* Corps */
  root:   { flex: 1, backgroundColor: NEO },
  scroll: { padding: 16, paddingBottom: 48 },

  loadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  loadingText: { fontSize: scale(13), color: TEXT3 },

  /* Bannières */
  bannerDanger: {
    marginBottom: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'flex-start',
    gap: 10, padding: 13,
    backgroundColor: Colors.dangerBg, borderWidth: 1, borderColor: Colors.dangerBorder,
  },
  bannerDangerText: { flex: 1, fontSize: scale(13), color: Colors.danger, lineHeight: 18 },
  bannerSuccess: {
    marginBottom: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'flex-start',
    gap: 10, padding: 13,
    backgroundColor: Colors.successBg, borderWidth: 1, borderColor: Colors.successBorder,
  },
  bannerSuccessText: { flex: 1, fontSize: scale(13), color: Colors.success, lineHeight: 18, fontWeight: '600' },

  /* Carte table */
  card: {
    marginBottom: 8, borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#DDE2E6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  tableHead: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: NEO_IN,
    borderBottomWidth: 1, borderBottomColor: SEP,
  },
  tableHeadText: { fontSize: scale(11), fontWeight: '700', color: TEXT3, letterSpacing: 1.2 },
  tableRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  tableRowSep:   { borderBottomWidth: 1, borderBottomColor: SEP },
  tableName:     { fontSize: scale(13), color: TEXT2, fontFamily: 'monospace', flex: 1, marginRight: 8 },
  countBadge:       { backgroundColor: NEO_IN, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, minWidth: 36, alignItems: 'center' },
  countBadgeActive: { backgroundColor: Colors.infoBg },
  countText:        { fontSize: scale(13), fontWeight: '700', color: TEXT3, fontFamily: 'monospace' },
  countTextActive:  { color: Colors.brandBlue },

  meta: { fontSize: scale(12), color: TEXT3, marginBottom: 14, marginTop: 4, fontStyle: 'italic', textAlign: 'center' },

  /* Pending */
  pendingBanner: {
    marginBottom: 18, borderRadius: 12, flexDirection: 'row', alignItems: 'center',
    gap: 12, padding: 14, borderWidth: 1,
  },
  pendingOk:       { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  pendingWarn:     { backgroundColor: Colors.warningBg, borderColor: Colors.warningBorder },
  pendingText:     { flex: 1, fontSize: scale(13), fontWeight: '600', lineHeight: 18 },
  pendingTextOk:   { color: Colors.success },
  pendingTextWarn: { color: Colors.warning },

  /* Bouton Rafraîchir */
  refreshBtn: {
    marginBottom: 10, borderRadius: 13,
    backgroundColor: Colors.brandBlue,
    paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#046a96', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
  refreshText: { color: '#fff', fontSize: scale(14), fontWeight: '700' },

  /* Bouton Réinitialiser */
  resetBtn: {
    marginBottom: 12, borderRadius: 12,
    backgroundColor: Colors.dangerBg,
    paddingVertical: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: Colors.dangerBorder,
  },
  resetText: { color: Colors.danger, fontSize: scale(14), fontWeight: '700' },
  resetSub:  { color: Colors.danger, fontSize: scale(11), opacity: 0.6, marginTop: 2 },
});
