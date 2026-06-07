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
  const [user, setUser] = useState<UtilisateurInfo | null>(null);
  const [programmes, setProgrammes] = useState<ProgrammeAvecProgression[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error' | 'info' }>({
    visible: false, message: '', type: 'success',
  });
  const { isConnected, justReconnected, clearReconnected } = useNetworkStatus();
  const [devUnlocked, setDevUnlocked] = useState<boolean>(false);
  const [pinVisible, setPinVisible] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinLoading, setPinLoading] = useState<boolean>(false);
  const devTapCount = useRef<number>(0);
  const devTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ticker pour que l'affichage "il y a X min" se rafraichisse chaque minute
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
      setPinVisible(false);
      setPinInput('');
      setDevUnlocked(true);
      showToast('Mode developpeur active', 'info');
    } else if (result === 'quota') {
      setPinInput('');
      showToast('Trop de tentatives — reessayez dans 1 heure', 'error');
    } else if (result === 'error') {
      setPinInput('');
      showToast('Connexion requise pour le mode developpeur', 'error');
    } else {
      setPinInput('');
      showToast('Code incorrect', 'error');
    }
  }

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ visible: true, message, type });
  }, []);

  const loadLocalData = useCallback(async () => {
    const progs = await getProgrammesRecents();
    setProgrammes(progs);
    const lp = await getLastPulledAt();
    setLastSync(lp);
    const pending = await countPending();
    setPendingCount(pending);
  }, []);

  useEffect(() => {
    fetchMe().then(setUser).catch(() => {});
    loadLocalData();
  }, [loadLocalData]);

  // Rafraîchit les données locales à chaque retour sur cet écran (focus).
  // Sans ça, pendingCount reste à sa valeur de montage et l'auto-sync sur
  // reconnexion ne se déclenche pas même si des opérations ont été saisies.
  useEffect(() => {
    const unsub = navigation.addListener('focus', loadLocalData);
    return unsub;
  }, [navigation, loadLocalData]);

  const handleSync = useCallback(async (): Promise<void> => {
    if (syncing) return;
    setSyncing(true);
    setSyncStatus('syncing');
    try {
      const { pull: pullRes, push: pushRes } = await syncAll();
      await loadLocalData();

      if (!pullRes.success || !pushRes.success) {
        setSyncStatus('error');
        const err = pullRes.error ?? pushRes.error ?? 'Erreur inconnue';
        showToast(err, 'error');
        return;
      }

      setSyncStatus('success');
      const envoyes = pushRes.pushed.operation + pushRes.pushed.ligne_operation + pushRes.pushed.anomalie;
      const recus = Object.values(pullRes.counts).reduce((a, b) => a + b, 0);

      if (envoyes > 0 || recus > 0) {
        showToast(`Sync OK — ${recus} reçus, ${envoyes} envoyés`, 'success');
      } else {
        showToast('Déjà à jour', 'info');
      }
    } finally {
      setSyncing(false);
    }
  }, [syncing, loadLocalData, showToast]);

  useEffect(() => {
    if (!justReconnected) return;
    clearReconnected();
    if (pendingCount > 0) {
      showToast('Réseau retrouvé — synchronisation en cours...', 'info');
      handleSync();
    }
  }, [justReconnected, clearReconnected, pendingCount, showToast, handleSync]);

  async function handleLogout(): Promise<void> {
    Alert.alert('Déconnexion', 'Confirmer la déconnexion ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnexion', style: 'destructive', onPress: async () => {
        await logout();
        navigation.replace('Login');
      }},
    ]);
  }

  const statusDot = syncStatus === 'success' ? '#34d399'
    : syncStatus === 'error' ? '#f87171'
    : syncStatus === 'syncing' ? '#fbbf24'
    : '#94a3b8';

  const renderProgramme = useCallback(({ item }: { item: ProgrammeAvecProgression }): React.ReactElement => {
    const pct = item.total_etapes > 0
      ? Math.round((item.etapes_visitees / item.total_etapes) * 100)
      : 0;
    const statutColor =
      item.statut === 'CLOTURE' ? '#198754' :
      item.statut === 'EN_COURS' ? '#1a7fba' : '#6c757d';
    const statutLabel =
      item.statut === 'CLOTURE' ? 'Clôturé' :
      item.statut === 'EN_COURS' ? 'En cours' : 'Planifié';

    return (
      <TouchableOpacity
        style={styles.progCard}
        onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
      >
        <View style={styles.progHeader}>
          <Text style={styles.progNumero}>{item.numero_x3}</Text>
          <View style={styles.badgesRow}>
            <View style={[
              styles.badge,
              item.type_programme === 'COLLECTE' ? styles.badgeCollecte : styles.badgeRestitution,
            ]}>
              <Text style={styles.badgeText}>{item.type_programme === 'COLLECTE' ? 'Collecte' : 'Restitution'}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: statutColor }]}>
              <Text style={[styles.badgeText, { color: '#fff' }]}>{statutLabel}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.progDate}>{item.date_programme}</Text>
        <View style={styles.progressRow}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: statutColor }]} />
          </View>
          <Text style={[styles.progProgress, { color: statutColor }]}>
            {item.etapes_visitees}/{item.total_etapes} étapes
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.headerLogo}
              resizeMode="contain"
            />
            <View style={{ flex: 1, flexShrink: 1 }}>
              <Text style={styles.welcomeSmall}>Bonjour,</Text>
              <Text style={styles.welcomeBig} numberOfLines={1}>
                {user ? `${user.first_name} ${user.last_name}` : '...'}
              </Text>
              <Text style={styles.subtitle}>{user?.code_livreur ?? ''}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
            <Text style={styles.statusLabel}>
              {syncStatus === 'syncing' ? 'Sync...' :
               syncStatus === 'success' ? 'En ligne' :
               syncStatus === 'error' ? 'Erreur' : 'Pret'}
            </Text>
          </View>
        </View>
      </View>

      <NetworkBanner isConnected={isConnected} />

      {/* Barre de synchronisation */}
      <View style={styles.syncBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.syncLabel}>Dernière sync</Text>
          <Text style={styles.syncValue}>{formatRelativeTime(lastSync)}</Text>
        </View>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>{pendingCount} en attente</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.syncButtonText}>Synchroniser</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Liste programmes */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Mes programmes du jour</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Historique')}>
          <Text style={styles.historiqueLink}>Historique ›</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProgramme}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={handleSync} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Aucun programme</Text>
            <Text style={styles.emptyText}>
              Appuie sur « Synchroniser » pour récupérer ton programme du jour.
            </Text>
            <TouchableOpacity style={styles.emptySyncBtn} onPress={handleSync} disabled={syncing}>
              <Text style={styles.emptySyncBtnText}>Synchroniser maintenant</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.footerText}>Déconnexion</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.devZone}>
        <TouchableOpacity
          onPress={handleDevTap}
          hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}
        >
          <Text style={styles.versionText}>v1.0 POC</Text>
        </TouchableOpacity>
        {devUnlocked && (
          <TouchableOpacity
            style={styles.debugLink}
            onPress={() => navigation.navigate('Debug')}
          >
            <Text style={styles.debugLinkText}>Debug BDD</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Overlay PIN mode developpeur */}
      {pinVisible && (
        <View style={styles.pinOverlay}>
          <View style={styles.pinCard}>
            <Text style={styles.pinTitle}>Mode developpeur</Text>
            <Text style={styles.pinSub}>Entrez le code d'acces</Text>
            <TextInput
              style={styles.pinInput}
              value={pinInput}
              onChangeText={setPinInput}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              placeholder="• • • •"
              placeholderTextColor="#aaa"
            />
            <View style={styles.pinActions}>
              <TouchableOpacity
                style={styles.pinCancelBtn}
                onPress={() => { setPinVisible(false); setPinInput(''); }}
              >
                <Text style={styles.pinCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pinConfirmBtn, pinLoading && { opacity: 0.6 }]}
                onPress={checkPin}
                disabled={pinLoading}
              >
                {pinLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.pinConfirmText}>Valider</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Toast */}
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  header: { backgroundColor: '#1a7fba', paddingHorizontal: 20, paddingTop: 44, paddingBottom: 16 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 },
  headerLogo: { width: 40, height: 40 },
  welcomeSmall: { color: '#d0e8f5', fontSize: 13 },
  welcomeBig: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2 },
  subtitle: { color: '#d0e8f5', fontSize: 13, marginTop: 1 },
  headerRight: { alignItems: 'center', paddingTop: 4 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginBottom: 4 },
  statusLabel: { color: '#d0e8f5', fontSize: 10, fontWeight: '600' },

  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 12,
    padding: 14,
    borderRadius: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  syncLabel: { fontSize: 11, color: '#aaa' },
  syncValue: { fontSize: 14, color: '#333', fontWeight: '600' },
  pendingBadge: {
    backgroundColor: '#fff3cd',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffc107',
  },
  pendingText: { fontSize: 11, color: '#664d03', fontWeight: '700' },
  syncButton: {
    backgroundColor: '#1a7fba',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 110,
    alignItems: 'center',
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  sectionHeader: { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333' },
  historiqueLink: { fontSize: 13, color: '#1a7fba' },

  list: { paddingHorizontal: 12, paddingBottom: 12 },
  progCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  progHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progNumero: { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  badgesRow: { flexDirection: 'row', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeCollecte: { backgroundColor: '#dbeafe' },
  badgeRestitution: { backgroundColor: '#dcfce7' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#333' },
  progDate: { color: '#aaa', fontSize: 12, marginTop: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressBar: { flex: 1, height: 6, backgroundColor: '#e9ecef', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  progProgress: { fontSize: 12, fontWeight: '700', minWidth: 70, textAlign: 'right' },

  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#555', marginBottom: 8 },
  emptyText: { color: '#aaa', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptySyncBtn: {
    backgroundColor: '#1a7fba', paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 8,
  },
  emptySyncBtnText: { color: '#fff', fontWeight: '700' },

  footer: { borderTopWidth: 1, borderTopColor: '#e0e0e0', backgroundColor: '#fff' },
  logoutButton: { padding: 14, alignItems: 'center', backgroundColor: '#1a2332' },
  footerText: { color: '#fff', fontWeight: '600' },
  devZone: { paddingVertical: 8, alignItems: 'center', gap: 4 },
  versionText: { color: '#ccc', fontSize: 11 },
  debugLink: { paddingVertical: 4, paddingHorizontal: 12 },
  debugLinkText: { color: '#1a7fba', fontSize: 12, fontWeight: '600' },

  pinOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  pinCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 24,
    width: 280,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  pinTitle: { fontSize: 16, fontWeight: '700', color: '#1a2332', textAlign: 'center' },
  pinSub: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 4, marginBottom: 16 },
  pinInput: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    padding: 12, fontSize: 22, textAlign: 'center',
    letterSpacing: 8, color: '#333', backgroundColor: '#f8f9fa',
  },
  pinActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 10 },
  pinCancelBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
  pinCancelText: { color: '#666', fontWeight: '600' },
  pinConfirmBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#1a7fba', alignItems: 'center' },
  pinConfirmText: { color: '#fff', fontWeight: '700' },
});
