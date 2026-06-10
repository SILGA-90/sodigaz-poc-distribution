/**
 * DashboardScreen — Néomorphisme clair.
 * Header navy (marque), corps NEO #e8edf2, cartes et boutons raised (double ombre).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import NeoDialog from '../components/NeoDialog';
import NetworkBanner from '../components/NetworkBanner';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { Colors } from '../theme';

/* ── Palette néo ─────────────────────────────────────────────────────── */
const NEO     = '#e8edf2';
const NEO_SHD = '#b8cad8';
const NEO_IN  = '#d4dde6';
const NAVY    = '#0a1628';
const TEXT    = '#1a2a3a';
const TEXT2   = '#3a5060';
const TEXT3   = '#5a7080';

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
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
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
      showToast(
        envoyes > 0 || recus > 0 ? `Sync OK — ${recus} reçus, ${envoyes} envoyés` : 'Déjà à jour',
        envoyes > 0 || recus > 0 ? 'success' : 'info',
      );
    } finally {
      setSyncing(false);
    }
  }, [syncing, loadLocalData, showToast]);

  useEffect(() => {
    if (!justReconnected) return;
    clearReconnected();
    if (pendingCount > 0) { showToast('Réseau retrouvé — synchronisation en cours...', 'info'); handleSync(); }
  }, [justReconnected, clearReconnected, pendingCount, showToast, handleSync]);

  function handleLogout(): void {
    setShowLogoutDialog(true);
  }

  const syncDotColor =
    syncStatus === 'success' ? Colors.success  :
    syncStatus === 'error'   ? Colors.danger    :
    syncStatus === 'syncing' ? Colors.warning   : '#8aa0b0';

  const syncLabel =
    syncStatus === 'syncing' ? 'Synchronisation...' :
    syncStatus === 'success' ? 'Synchronisé' :
    syncStatus === 'error'   ? 'Erreur de sync' : 'Prêt';

  /* ── Carte programme ─────────────────────────────────────────────────── */
  const renderProgramme = useCallback(({ item }: { item: ProgrammeAvecProgression }): React.ReactElement => {
    const pct = item.total_etapes > 0
      ? Math.round((item.etapes_visitees / item.total_etapes) * 100) : 0;
    const isCollecte = item.type_programme === 'COLLECTE';

    const accentColor =
      item.statut === 'CLOTURE'  ? Colors.success  :
      item.statut === 'EN_COURS' ? Colors.brandBlue : TEXT3;
    const pillBg =
      item.statut === 'CLOTURE'  ? Colors.successBg :
      item.statut === 'EN_COURS' ? Colors.infoBg    : NEO_IN;
    const statutLabel =
      item.statut === 'CLOTURE'  ? 'Clôturé' :
      item.statut === 'EN_COURS' ? 'En cours' : 'Planifié';

    return (
      /* Raised — double ombre */
      <View style={styles.progOuter}>
        <View style={styles.progShadowLight}>
          <TouchableOpacity
            style={styles.progContent}
            onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
            activeOpacity={0.8}
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
              {/* Barre de progression inset */}
              <View style={styles.progBarWrap}>
                <View style={styles.progBarTrack}>
                  <View style={[styles.progBarFill, { width: `${pct}%` as any, backgroundColor: accentColor }]} />
                </View>
                <Text style={[styles.progPct, { color: accentColor }]}>{item.etapes_visitees}/{item.total_etapes}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [navigation]);

  /* ── Rendu ───────────────────────────────────────────────────────────── */
  return (
    <View style={styles.root}>

      {/* ── Header navy ── */}
      <View style={styles.header}>
        <View style={styles.hBubble1} pointerEvents="none" />
        <View style={styles.hBubble2} pointerEvents="none" />

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

      {/* ── Carte de synchronisation raised ── */}
      <View style={styles.syncOuter}>
        <View style={styles.syncShadowLight}>
          <View style={styles.syncContent}>
            <View style={styles.syncLeft}>
              <Text style={styles.syncCardLabel}>Dernière synchronisation</Text>
              <Text style={styles.syncCardValue}>{formatRelativeTime(lastSync)}</Text>
            </View>
            {pendingCount > 0 && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingText}>{pendingCount} en attente</Text>
              </View>
            )}
            {/* Bouton sync raised bleu */}
            <View style={[styles.sBtnOuter, syncing && { opacity: 0.55 }]}>
              <TouchableOpacity style={styles.sBtnInner} onPress={handleSync} disabled={syncing} activeOpacity={0.82}>
                {syncing
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.sBtnText}>↑  Sync</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* ── Section titre ── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Mes programmes du jour</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Historique')}>
          <Text style={styles.sectionLink}>Historique ›</Text>
        </TouchableOpacity>
      </View>

      {/* ── Liste des programmes ── */}
      <FlatList
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProgramme}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={handleSync} tintColor={Colors.brandBlue} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {/* Icône raised */}
            <View style={styles.emptyIconOuter}>
              <View style={styles.emptyIconInner}>
                <Text style={styles.emptyIconText}>📋</Text>
              </View>
            </View>
            <Text style={styles.emptyTitle}>Aucun programme</Text>
            <Text style={styles.emptySub}>Appuie sur « Synchroniser » pour récupérer ton programme du jour.</Text>
            {/* Bouton sync vide raised bleu */}
            <View style={styles.emptyBtnOuter}>
              <TouchableOpacity style={styles.emptyBtnInner} onPress={handleSync} disabled={syncing} activeOpacity={0.82}>
                <Text style={styles.emptyBtnText}>Synchroniser maintenant</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
      />

      {/* ── Footer ── */}
      <View style={styles.footer}>
        {/* Déconnexion raised danger */}
        <View style={styles.logoutOuter}>
          <TouchableOpacity style={styles.logoutInner} onPress={handleLogout} activeOpacity={0.82}>
            <Text style={styles.logoutText}>Déconnexion</Text>
          </TouchableOpacity>
        </View>
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

      {/* ── Overlay PIN (conservé sombre — sécurité) ── */}
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

      {/* ── Dialog déconnexion ── */}
      <NeoDialog
        visible={showLogoutDialog}
        icon={pendingCount > 0 ? 'warning-outline' : 'log-out-outline'}
        iconColor={pendingCount > 0 ? Colors.warning : Colors.danger}
        title={pendingCount > 0 ? 'Données non synchronisées' : 'Déconnexion'}
        message={
          pendingCount > 0
            ? `${pendingCount} élément(s) n'ont pas encore été envoyés au serveur.\n\nSynchronisez d'abord ou déconnectez-vous quand même.`
            : 'Confirmer la déconnexion ?'
        }
        confirmLabel="Se déconnecter"
        cancelLabel={pendingCount > 0 ? 'Rester' : 'Annuler'}
        danger
        onCancel={() => setShowLogoutDialog(false)}
        onConfirm={async () => {
          setShowLogoutDialog(false);
          await logout();
          navigation.replace('Login');
        }}
      />

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
  root: { flex: 1, backgroundColor: NEO },

  /* ── Header navy ─────────────────────────────────────────────────────── */
  header: { backgroundColor: NAVY, paddingTop: 48, paddingBottom: 20, paddingHorizontal: 16, overflow: 'hidden' },
  hBubble1: { position: 'absolute', borderRadius: 999, width: 280, height: 280, top: -80,  right: -80, backgroundColor: 'rgba(7,155,217,0.1)' },
  hBubble2: { position: 'absolute', borderRadius: 999, width: 140, height: 140, bottom: -30, left: -40, backgroundColor: 'rgba(238,114,2,0.07)' },

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

  /* ── Carte synchronisation raised ────────────────────────────────────── */
  syncOuter: {
    marginHorizontal: 16,
    marginTop:        14,
    marginBottom:     12,
    borderRadius:     16,
    backgroundColor:  NEO,
    shadowColor:      '#4a6880',
    shadowOffset:     { width: 6, height: 6 },
    shadowOpacity:    1,
    shadowRadius:     7,
    elevation:        10,
  },
  syncShadowLight: {
    borderRadius:    16,
    backgroundColor: NEO,
    shadowColor:     '#ffffff',
    shadowOffset:    { width: -6, height: -6 },
    shadowOpacity:   1,
    shadowRadius:    7,
  },
  syncContent: {
    flexDirection:     'row',
    alignItems:        'center',
    borderRadius:      16,
    backgroundColor:   NEO,
    padding:           16,
    gap:               10,
    borderTopWidth:    1,   borderLeftWidth:    1,
    borderBottomWidth: 1,   borderRightWidth:   1,
    borderTopColor:    'rgba(255,255,255,0.85)',
    borderLeftColor:   'rgba(255,255,255,0.85)',
    borderBottomColor: 'rgba(74,104,128,0.35)',
    borderRightColor:  'rgba(74,104,128,0.35)',
  },
  syncLeft:      { flex: 1 },
  syncCardLabel: { fontSize: 11, color: TEXT3, fontWeight: '500' },
  syncCardValue: { fontSize: 15, color: TEXT,  fontWeight: '700', marginTop: 2 },

  pendingBadge: { backgroundColor: Colors.warningBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: Colors.warningBorder },
  pendingText:  { fontSize: 11, color: Colors.warning, fontWeight: '700' },

  /* Bouton sync raised bleu */
  sBtnOuter: {
    borderRadius:    20,
    backgroundColor: Colors.brandBlue,
    shadowColor:     '#02405a',
    shadowOffset:    { width: 5, height: 5 },
    shadowOpacity:   0.5,
    shadowRadius:    10,
    elevation:       6,
  },
  sBtnInner: {
    borderRadius:      20,
    backgroundColor:   Colors.brandBlue,
    paddingVertical:   10,
    paddingHorizontal: 16,
    alignItems:        'center',
    shadowColor:       '#60d4ff',
    shadowOffset:      { width: -3, height: -3 },
    shadowOpacity:     0.4,
    shadowRadius:       6,
    borderTopWidth:    1,
    borderLeftWidth:   1,
    borderBottomWidth: 1,
    borderRightWidth:  1,
    borderTopColor:    '#2bb8ef',
    borderLeftColor:   '#2bb8ef',
    borderBottomColor: '#046a96',
    borderRightColor:  '#046a96',
  },
  sBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  /* ── Section titre ───────────────────────────────────────────────────── */
  sectionRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: TEXT2 },
  sectionLink:  { fontSize: 13, color: Colors.brandBlue, fontWeight: '600' },

  list: { paddingHorizontal: 14, paddingVertical: 6, paddingBottom: 12 },

  /* ── Cartes programme raised ──────────────────────────────────────────── */
  progOuter: {
    marginBottom:    14,
    borderRadius:    16,
    backgroundColor: NEO,
    shadowColor:     '#4a6880',
    shadowOffset:    { width: 6, height: 6 },
    shadowOpacity:   1,
    shadowRadius:    7,
    elevation:       10,
  },
  progShadowLight: {
    borderRadius:    16,
    backgroundColor: NEO,
    shadowColor:     '#ffffff',
    shadowOffset:    { width: -6, height: -6 },
    shadowOpacity:   1,
    shadowRadius:    7,
  },
  progContent: {
    flexDirection:     'row',
    borderRadius:      16,
    backgroundColor:   NEO,
    overflow:          'hidden',
    borderTopWidth:    1,   borderLeftWidth:    1,
    borderBottomWidth: 1,   borderRightWidth:   1,
    borderTopColor:    'rgba(255,255,255,0.85)',
    borderLeftColor:   'rgba(255,255,255,0.85)',
    borderBottomColor: 'rgba(74,104,128,0.35)',
    borderRightColor:  'rgba(74,104,128,0.35)',
  },
  progAccent: { width: 5 },
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
  /* Barre de progression inset */
  progBarWrap:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progBarTrack: {
    flex: 1, height: 6, borderRadius: 3, overflow: 'hidden',
    backgroundColor: NEO_IN,
    borderTopWidth:    1, borderLeftWidth:   1,
    borderBottomWidth: 1, borderRightWidth:  1,
    borderTopColor: '#a8bac8',    borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
  },
  progBarFill:  { height: 6, borderRadius: 3 },
  progPct:      { fontSize: 12, fontWeight: '700', minWidth: 38, textAlign: 'right' },

  /* ── État vide ───────────────────────────────────────────────────────── */
  emptyWrap:  { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  emptyIconOuter: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: NEO, marginBottom: 20,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.6, shadowRadius: 10, elevation: 4,
  },
  emptyIconInner: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: NEO, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#ffffff', shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.85, shadowRadius: 8,
  },
  emptyIconText: { fontSize: 28 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginBottom: 8 },
  emptySub:   { color: TEXT3, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtnOuter: {
    borderRadius: 14, backgroundColor: Colors.brandBlue,
    shadowColor: '#02405a', shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6,
  },
  emptyBtnInner: {
    borderRadius: 14, backgroundColor: Colors.brandBlue,
    paddingVertical: 14, paddingHorizontal: 28,
    shadowColor: '#60d4ff', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.4, shadowRadius: 6,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#2bb8ef', borderLeftColor: '#2bb8ef',
    borderBottomColor: '#046a96', borderRightColor: '#046a96',
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  /* ── Footer ──────────────────────────────────────────────────────────── */
  footer: {
    paddingHorizontal: 16,
    paddingBottom:     12,
    paddingTop:        10,
    borderTopWidth:    1,
    borderTopColor:    NEO_IN,
  },
  /* Déconnexion raised danger */
  logoutOuter: {
    borderRadius:    12,
    backgroundColor: Colors.dangerBg,
    shadowColor:     '#991111',
    shadowOffset:    { width: 5, height: 5 },
    shadowOpacity:   0.3,
    shadowRadius:    10,
    elevation:       4,
  },
  logoutInner: {
    borderRadius:    12,
    backgroundColor: Colors.dangerBg,
    paddingVertical: 13,
    alignItems:      'center',
    shadowColor:     '#fff0f0',
    shadowOffset:    { width: -3, height: -3 },
    shadowOpacity:   0.7,
    shadowRadius:     6,
    borderTopWidth:    1, borderLeftWidth:   1,
    borderBottomWidth: 1, borderRightWidth:  1,
    borderTopColor:    '#fdd',    borderLeftColor:    '#fdd',
    borderBottomColor: '#e88',    borderRightColor:   '#e88',
  },
  logoutText: { color: Colors.danger, fontWeight: '700', fontSize: 14 },
  devZone:    { alignItems: 'center', gap: 4, paddingVertical: 8, flexDirection: 'row', justifyContent: 'center' },
  versionText:{ color: TEXT3, fontSize: 11 },
  debugLink:  { paddingVertical: 4, paddingHorizontal: 12 },
  debugLinkText: { color: Colors.brandBlue, fontSize: 12, fontWeight: '600' },

  /* ── Overlay PIN (conservé sombre — sécurité) ────────────────────────── */
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
