/**
 * Tableau de bord livreur — light thème.
 * Header navy (identité de marque), corps blanc/gris clair (lisibilité terrain).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { fetchMe, logout, verifyDevAccess } from '../api/authService';
import { syncAll } from '../sync/syncService';
import { getProgrammesRecents, ProgrammeAvecProgression } from '../db/repositories/programmeRepository';
import { countPending } from '../db/repositories/operationRepository';
import { getLastPulledAt } from '../db/database';
import { UtilisateurInfo } from '../types/auth';
import { RootStackParamList } from '../types/navigation';
import Toast from '../components/Toast';
import NetworkBanner from '../components/NetworkBanner';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { Colors } from '../theme';

const NAVY  = '#0a1628';
const BG    = '#f0f4f8';
const CARD  = '#ffffff';
const INPUT = '#f1f5f9';
const BORDER= '#e2e8f0';
const TEXT  = '#0f172a';
const TEXT2 = '#334155';
const TEXT3 = '#64748b';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;
type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

function formatRelativeTime(ts: number): string {
  if (ts === 0) return 'jamais';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'à l\'instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export default function DashboardScreen({ navigation }: Props): React.ReactElement {
  const [user, setUser]             = useState<UtilisateurInfo | null>(null);
  const [programmes, setProgrammes] = useState<ProgrammeAvecProgression[]>([]);
  const [syncing, setSyncing]       = useState(false);
  const [lastSync, setLastSync]     = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error' | 'info' }>({
    visible: false, message: '', type: 'success',
  });
  const { isConnected, justReconnected, clearReconnected } = useNetworkStatus();
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [pinVisible, setPinVisible]   = useState(false);
  const [pinInput, setPinInput]       = useState('');
  const [pinLoading, setPinLoading]   = useState(false);
  const devTapCount = useRef(0);
  const devTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setTick((n) => n + 1), 60000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  function handleDevTap(): void {
    devTapCount.current += 1;
    if (devTapTimer.current) clearTimeout(devTapTimer.current);
    if (devTapCount.current >= 7) {
      devTapCount.current = 0;
      setPinInput('');
      setPinVisible(true);
    } else {
      devTapTimer.current = setTimeout(() => { devTapCount.current = 0; }, 2000);
    }
  }

  async function checkPin(): Promise<void> {
    setPinLoading(true);
    const result = await verifyDevAccess(pinInput);
    setPinLoading(false);
    if (result === 'ok') {
      setPinVisible(false); setPinInput(''); setDevUnlocked(true);
      showToast('Mode développeur activé', 'info');
    } else if (result === 'quota') {
      setPinInput(''); showToast('Trop de tentatives — réessayez dans 1 heure', 'error');
    } else if (result === 'error') {
      setPinInput(''); showToast('Connexion requise pour le mode développeur', 'error');
    } else {
      setPinInput(''); showToast('Code incorrect', 'error');
    }
  }

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ visible: true, message, type });
  }, []);

  const loadLocalData = useCallback(async () => {
    const progs   = await getProgrammesRecents();
    const lp      = await getLastPulledAt();
    const pending = await countPending();
    setProgrammes(progs);
    setLastSync(lp);
    setPendingCount(pending);
  }, []);

  useEffect(() => {
    fetchMe().then(setUser).catch(() => {});
    loadLocalData();
  }, [loadLocalData]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', loadLocalData);
    return unsub;
  }, [navigation, loadLocalData]);

  const handleSync = useCallback(async (): Promise<void> => {
    if (syncing) return;
    setSyncing(true); setSyncStatus('syncing');
    try {
      const { pull: pullRes, push: pushRes } = await syncAll();
      await loadLocalData();
      if (!pullRes.success || !pushRes.success) {
        setSyncStatus('error');
        showToast(pullRes.error ?? pushRes.error ?? 'Erreur inconnue', 'error');
        return;
      }
      setLastSync(Date.now()); setSyncStatus('success');
      const envoyes = pushRes.pushed.operation + pushRes.pushed.ligne_operation + pushRes.pushed.anomalie;
      const recus   = Object.values(pullRes.counts).reduce((a, b) => a + b, 0);
      showToast(envoyes > 0 || recus > 0 ? `Sync OK — ${recus} reçus, ${envoyes} envoyés` : 'Déjà à jour',
                envoyes > 0 || recus > 0 ? 'success' : 'info');
    } finally {
      setSyncing(false);
    }
  }, [syncing, loadLocalData, showToast]);

  useEffect(() => {
    if (!justReconnected) return;
    clearReconnected();
    if (pendingCount > 0) { showToast('Réseau retrouvé — synchronisation en cours...', 'info'); handleSync(); }
  }, [justReconnected, clearReconnected, pendingCount, showToast, handleSync]);

  async function handleLogout(): Promise<void> {
    if (pendingCount > 0) {
      Alert.alert('Données non synchronisées',
        `${pendingCount} élément(s) n'ont pas encore été envoyés au serveur.\n\nSynchronisez d'abord, puis déconnectez-vous.`,
        [
          { text: 'Rester', style: 'cancel' },
          { text: 'Se déconnecter quand même', style: 'destructive',
            onPress: async () => { await logout(); navigation.replace('Login'); } },
        ]);
      return;
    }
    Alert.alert('Déconnexion', 'Confirmer la déconnexion ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnexion', style: 'destructive',
        onPress: async () => { await logout(); navigation.replace('Login'); } },
    ]);
  }

  const syncDotColor =
    syncStatus === 'success' ? Colors.success  :
    syncStatus === 'error'   ? Colors.danger    :
    syncStatus === 'syncing' ? Colors.warning   : TEXT3;

  const syncLabel =
    syncStatus === 'syncing' ? 'Synchronisation...' :
    syncStatus === 'success' ? 'Synchronisé' :
    syncStatus === 'error'   ? 'Erreur de sync' : 'Prêt';

  const renderProgramme = useCallback(({ item }: { item: ProgrammeAvecProgression }): React.ReactElement => {
    const pct = item.total_etapes > 0
      ? Math.round((item.etapes_visitees / item.total_etapes) * 100) : 0;
    const isCollecte = item.type_programme === 'COLLECTE';

    const accentColor =
      item.statut === 'CLOTURE'  ? Colors.success  :
      item.statut === 'EN_COURS' ? Colors.brandBlue : TEXT3;
    const pillBg =
      item.statut === 'CLOTURE'  ? Colors.successBg  :
      item.statut === 'EN_COURS' ? Colors.infoBg     : '#f1f5f9';
    const statutLabel =
      item.statut === 'CLOTURE'  ? 'Clôturé' :
      item.statut === 'EN_COURS' ? 'En cours' : 'Planifié';

    return (
      <View style={styles.progCard}>
        <TouchableOpacity
          style={styles.progCardInner}
          onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
          activeOpacity={0.75}
        >
          <View style={[styles.progAccent, { backgroundColor: accentColor }]} />
          <View style={styles.progBody}>
            <View style={styles.progRow1}>
              <Text style={styles.progNumero} numberOfLines={1}>{item.numero_x3}</Text>
              <View style={[styles.statutPill, { backgroundColor: pillBg }]}>
                <View style={[styles.statutDot, { backgroundColor: accentColor }]} />
                <Text style={[styles.statutPillText, { color: accentColor }]}>{statutLabel}</Text>
              </View>
            </View>
            <View style={styles.progRow2}>
              <View style={[styles.typeChip, isCollecte ? styles.typeC : styles.typeR]}>
                <Text style={[styles.typeChipText, isCollecte ? styles.typeCText : styles.typeRText]}>
                  {isCollecte ? 'Collecte' : 'Restitution'}
                </Text>
              </View>
              <Text style={styles.progDate}>{item.date_programme}</Text>
            </View>
            <View style={styles.progBarWrap}>
              <View style={styles.progBarTrack}>
                <View style={[styles.progBarFill, { width: `${pct}%` as any, backgroundColor: accentColor }]} />
              </View>
              <Text style={[styles.progPct, { color: accentColor }]}>{item.etapes_visitees}/{item.total_etapes}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [navigation]);

  return (
    <View style={styles.root}>

      {/* ── Header navy ── */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />

        <View style={styles.headerTop}>
          <Image source={require('../../assets/logo.png')} style={styles.headerLogo} resizeMode="contain" />
          <View style={styles.syncPill}>
            <View style={[styles.syncDot, { backgroundColor: syncDotColor }]} />
            <Text style={styles.syncPillText}>{syncLabel}</Text>
          </View>
        </View>

        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user ? `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase() : '?'}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userHello}>Bonjour,</Text>
            <Text style={styles.userName} numberOfLines={1}>
              {user ? `${user.first_name} ${user.last_name}` : '—'}
            </Text>
            <Text style={styles.userCode}>{user?.code_livreur ?? ''}</Text>
          </View>
          <Image source={require('../../assets/logo_name.png')} style={styles.brandLogo} resizeMode="contain" />
        </View>
      </View>

      <NetworkBanner isConnected={isConnected} />

      {/* ── Carte de synchronisation ── */}
      <View style={styles.syncCard}>
        <View style={styles.syncCardLeft}>
          <Text style={styles.syncCardLabel}>Dernière synchronisation</Text>
          <Text style={styles.syncCardValue}>{formatRelativeTime(lastSync)}</Text>
        </View>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>{pendingCount} en attente</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          onPress={handleSync}
          disabled={syncing}
          activeOpacity={0.82}
        >
          {syncing
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.syncBtnText}>↑  Synchroniser</Text>
          }
        </TouchableOpacity>
      </View>

      {/* ── Section programmes ── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Mes programmes du jour</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Historique')}>
          <Text style={styles.sectionLink}>Historique ›</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProgramme}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={handleSync} tintColor={Colors.brandBlue} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyIconText}>📋</Text>
            </View>
            <Text style={styles.emptyTitle}>Aucun programme</Text>
            <Text style={styles.emptySub}>Appuie sur « Synchroniser » pour récupérer ton programme du jour.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={handleSync} disabled={syncing} activeOpacity={0.82}>
              <Text style={styles.emptyBtnText}>Synchroniser maintenant</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.78}>
          <Text style={styles.logoutText}>Déconnexion</Text>
        </TouchableOpacity>
        <View style={styles.devZone}>
          <TouchableOpacity onPress={handleDevTap} hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}>
            <Text style={styles.versionText}>v1.0 POC</Text>
          </TouchableOpacity>
          {devUnlocked && (
            <TouchableOpacity style={styles.debugLink} onPress={() => navigation.navigate('Debug')}>
              <Text style={styles.debugLinkText}>Debug BDD</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Overlay PIN (garde le thème sombre — sécurité) ── */}
      {pinVisible && (
        <View style={styles.pinOverlay}>
          <View style={styles.pinCard}>
            <Text style={styles.pinTitle}>Mode développeur</Text>
            <Text style={styles.pinSub}>Entrez le code d'accès</Text>
            <View style={styles.pinInputWrap}>
              <TextInput
                style={styles.pinInput}
                value={pinInput}
                onChangeText={setPinInput}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
                autoFocus
                placeholder="• • • •"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
            </View>
            <View style={styles.pinActions}>
              <TouchableOpacity style={styles.pinCancelBtn}
                onPress={() => { setPinVisible(false); setPinInput(''); }}>
                <Text style={styles.pinCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pinConfirmBtn, pinLoading && { opacity: 0.6 }]}
                onPress={checkPin} disabled={pinLoading}>
                {pinLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.pinConfirmText}>Valider</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── Header navy ───────────────────────────────────────────────────────────
  header: { backgroundColor: NAVY, paddingTop: 48, paddingBottom: 20, paddingHorizontal: 16, overflow: 'hidden' },
  bubble1: { position: 'absolute', borderRadius: 999, width: 280, height: 280, top: -80, right: -80, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', borderRadius: 999, width: 140, height: 140, bottom: -30, left: -40, backgroundColor: 'rgba(238,114,2,0.07)' },

  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerLogo: { width: 40, height: 40 },
  syncPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  syncDot:  { width: 8, height: 8, borderRadius: 4 },
  syncPillText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },

  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  avatar:   { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.brandOrange, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  userInfo: { flex: 1 },
  userHello:{ color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  userName: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 1 },
  userCode: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  brandLogo:{ width: 56, height: 34, opacity: 0.5 },

  // ── Sync card ─────────────────────────────────────────────────────────────
  syncCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, marginHorizontal: 16, marginTop: 14, marginBottom: 12,
    borderRadius: 14, padding: 14,
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  syncCardLeft:  { flex: 1 },
  syncCardLabel: { fontSize: 11, color: TEXT3, fontWeight: '500' },
  syncCardValue: { fontSize: 15, color: TEXT, fontWeight: '700', marginTop: 2 },

  pendingBadge: { backgroundColor: Colors.warningBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: Colors.warningBorder },
  pendingText:  { fontSize: 11, color: Colors.warning, fontWeight: '700' },

  syncBtn: { backgroundColor: Colors.brandBlue, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // ── Section ───────────────────────────────────────────────────────────────
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: TEXT2 },
  sectionLink:  { fontSize: 13, color: Colors.brandBlue, fontWeight: '600' },

  list: { paddingHorizontal: 16, paddingBottom: 8 },

  // ── Cartes programme ──────────────────────────────────────────────────────
  progCard: { borderRadius: 14, marginBottom: 12, backgroundColor: CARD, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  progCardInner: { flexDirection: 'row', borderRadius: 14, overflow: 'hidden' },
  progAccent: { width: 4 },
  progBody:   { flex: 1, padding: 14 },
  progRow1:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progNumero: { fontSize: 14, fontWeight: '700', color: TEXT, flex: 1, marginRight: 8 },
  statutPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutDot:  { width: 6, height: 6, borderRadius: 3 },
  statutPillText: { fontSize: 11, fontWeight: '700' },
  progRow2:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  typeChip:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeC:     { backgroundColor: Colors.infoBg },
  typeR:     { backgroundColor: Colors.successBg },
  typeChipText: { fontSize: 10, fontWeight: '700' },
  typeCText:    { color: Colors.brandBlue },
  typeRText:    { color: Colors.success },
  progDate:  { fontSize: 12, color: TEXT3 },
  progBarWrap:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progBarTrack: { flex: 1, height: 6, backgroundColor: INPUT, borderRadius: 3, overflow: 'hidden' },
  progBarFill:  { height: 6, borderRadius: 3 },
  progPct:      { fontSize: 12, fontWeight: '700', minWidth: 38, textAlign: 'right' },

  // ── État vide ─────────────────────────────────────────────────────────────
  emptyWrap:  { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  emptyIcon:  { width: 72, height: 72, borderRadius: 36, backgroundColor: CARD, justifyContent: 'center', alignItems: 'center', marginBottom: 20, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  emptyIconText: { fontSize: 28 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginBottom: 8 },
  emptySub:   { color: TEXT3, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn:   { backgroundColor: Colors.brandBlue, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: BORDER },
  logoutBtn: { backgroundColor: Colors.dangerBg, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: Colors.dangerBorder },
  logoutText: { color: Colors.danger, fontWeight: '700', fontSize: 14 },
  devZone:    { alignItems: 'center', gap: 4, paddingVertical: 8 },
  versionText:{ color: TEXT3, fontSize: 11 },
  debugLink:  { paddingVertical: 4, paddingHorizontal: 12 },
  debugLinkText: { color: Colors.brandBlue, fontSize: 12, fontWeight: '600' },

  // ── Overlay PIN (conservé sombre — sécurité) ──────────────────────────────
  pinOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center' },
  pinCard: { width: 300, backgroundColor: '#0d1e35', borderRadius: 24, padding: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  pinTitle: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' },
  pinSub:   { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  pinInputWrap: { backgroundColor: '#091527', borderRadius: 12, marginBottom: 20, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.5)' },
  pinInput:  { paddingVertical: 14, fontSize: 24, textAlign: 'center', letterSpacing: 10, color: '#fff' },
  pinActions:   { flexDirection: 'row', gap: 12 },
  pinCancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#112240' },
  pinCancelText:{ color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  pinConfirmBtn:{ flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: Colors.brandBlue },
  pinConfirmText: { color: '#fff', fontWeight: '700' },
});
