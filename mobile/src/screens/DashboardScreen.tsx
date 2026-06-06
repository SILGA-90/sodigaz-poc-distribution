import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { fetchMe, logout } from '../api/authService';
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
  if (diffMin < 1) return 'a l\'instant';
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
  // Ticker pour que l'affichage "il y a X min" se rafraichisse chaque minute
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((n) => n + 1), 60000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ visible: true, message, type });
  }

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

  useEffect(() => {
    if (!justReconnected) return;
    clearReconnected();
    if (pendingCount > 0) {
      showToast('Reseau retrouve — synchronisation en cours...', 'info');
      handleSync();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justReconnected]);

  async function handleSync(): Promise<void> {
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
        showToast(
          `Sync OK — ${recus} recus, ${envoyes} envoyes`,
          'success',
        );
      } else {
        showToast('Deja a jour', 'info');
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleLogout(): Promise<void> {
    Alert.alert('Deconnexion', 'Confirmer la deconnexion ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Deconnexion', style: 'destructive', onPress: async () => {
        await logout();
        navigation.replace('Login');
      }},
    ]);
  }

  const statusDot = syncStatus === 'success' ? '#34d399'
    : syncStatus === 'error' ? '#f87171'
    : syncStatus === 'syncing' ? '#fbbf24'
    : '#94a3b8';

  function renderProgramme({ item }: { item: ProgrammeAvecProgression }): React.ReactElement {
    const pct = item.total_etapes > 0
      ? Math.round((item.etapes_visitees / item.total_etapes) * 100)
      : 0;
    const statutColor =
      item.statut === 'CLOTURE' ? '#198754' :
      item.statut === 'EN_COURS' ? '#0d6efd' : '#6c757d';
    const statutLabel =
      item.statut === 'CLOTURE' ? 'Cloture' :
      item.statut === 'EN_COURS' ? 'En cours' : 'Planifie';

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
              <Text style={styles.badgeText}>{item.type_programme}</Text>
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
            {item.etapes_visitees}/{item.total_etapes} etapes
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.welcomeSmall}>Bonjour,</Text>
            <Text style={styles.welcomeBig}>
              {user ? `${user.first_name} ${user.last_name}` : '...'}
            </Text>
            <Text style={styles.subtitle}>{user?.code_livreur ?? ''}</Text>
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
          <Text style={styles.syncLabel}>Derniere sync</Text>
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
              Appuie sur "Synchroniser" pour recuperer ton programme du jour.
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
          <Text style={styles.footerText}>Deconnexion</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.debugLink} onPress={() => navigation.navigate('Debug')}>
        <Text style={styles.debugLinkText}>Debug BDD</Text>
      </TouchableOpacity>

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

  header: { backgroundColor: '#0d6efd', paddingHorizontal: 20, paddingTop: 44, paddingBottom: 16 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  welcomeSmall: { color: '#cbe2ff', fontSize: 13 },
  welcomeBig: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2 },
  subtitle: { color: '#cbe2ff', fontSize: 13, marginTop: 1 },
  headerRight: { alignItems: 'center', paddingTop: 4 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginBottom: 4 },
  statusLabel: { color: '#cbe2ff', fontSize: 10, fontWeight: '600' },

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
    backgroundColor: '#0d6efd',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 110,
    alignItems: 'center',
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  sectionHeader: { marginHorizontal: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333' },

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
    backgroundColor: '#0d6efd', paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 8,
  },
  emptySyncBtnText: { color: '#fff', fontWeight: '700' },

  footer: { borderTopWidth: 1, borderTopColor: '#e0e0e0', backgroundColor: '#fff' },
  logoutButton: { padding: 14, alignItems: 'center', backgroundColor: '#dc3545' },
  footerText: { color: '#fff', fontWeight: '600' },
  debugLink: { padding: 8, alignItems: 'center' },
  debugLinkText: { color: '#ccc', fontSize: 11 },
});
