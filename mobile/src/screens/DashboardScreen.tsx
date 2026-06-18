/**
 * Tableau de bord du livreur : vue principale après connexion.
 *
 * Cet écran liste les programmes actifs (non clôturés) du livreur,
 * affiche l'état de synchronisation, et déclenche syncAll() manuellement
 * ou automatiquement à la reconnexion réseau. Il expose aussi le bouton
 * de déconnexion et le mécanisme d'accès au mode développeur (7 taps +
 * PIN serveur).
 *
 * Dès que le réseau revient,
 * si des données sont en attente (pendingCount > 0), on lance syncAll()
 * automatiquement pour réduire le délai de remontée des opérations terrain.
 * L'utilisateur est notifié via un Toast "Réseau retrouvé".
 *
 * formatRelativeTime() affiche "il y a 5 min". Sans re-render périodique,
 * cette valeur vieillirait sans se mettre à jour. On force un re-render
 * toutes les minutes pour que l'affichage reste cohérent, sans déclencher
 * de requête SQL.
 *
 * Si le livreur tente de se déconnecter avec des données PENDING, on
 * l'avertit explicitement. Il peut choisir de synchroniser d'abord ou
 * de se déconnecter quand même (données perdues = sa responsabilité).
 *
 * La liste des programmes est rechargée à chaque fois que cet écran
 * devient actif (retour depuis ProgrammeScreen). Sans ça, une clôture
 * effectuée dans ProgrammeScreen ne serait pas visible jusqu'au prochain pull.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
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
import { useLayout } from '../hooks/useLayout';
import { Colors, scale } from '../theme';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import SyncCard from '../components/dashboard/SyncCard';
import ProgrammeCard from '../components/dashboard/ProgrammeCard';
import EmptyProgrammes from '../components/dashboard/EmptyProgrammes';
import DashboardFooter from '../components/dashboard/DashboardFooter';
import DevPinOverlay from '../components/dashboard/DevPinOverlay';
import { NEO, TEXT2 } from '../components/dashboard/dashStyles';

type Props       = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;
type SyncStatus  = 'idle' | 'syncing' | 'success' | 'error';

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
  const { numColumns } = useLayout();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [pinVisible, setPinVisible]   = useState(false);
  const [pinInput, setPinInput]       = useState('');
  const [pinLoading, setPinLoading]   = useState(false);
  const devTapCount = useRef(0);
  const devTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Re-render toutes les minutes pour actualiser formatRelativeTime */
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
      setPinInput(''); showToast('Trop de tentatives : réessayez dans 1 heure', 'error');
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
        envoyes > 0 || recus > 0 ? `Sync OK : ${recus} reçus, ${envoyes} envoyés` : 'Déjà à jour',
        envoyes > 0 || recus > 0 ? 'success' : 'info',
      );
    } finally {
      setSyncing(false);
    }
  }, [syncing, loadLocalData, showToast]);

  useEffect(() => {
    if (!justReconnected) return;
    clearReconnected();
    if (pendingCount > 0) { showToast('Réseau retrouvé : synchronisation en cours...', 'info'); handleSync(); }
  }, [justReconnected, clearReconnected, pendingCount, showToast, handleSync]);

  const syncDotColor =
    syncStatus === 'success' ? Colors.success  :
    syncStatus === 'error'   ? Colors.danger    :
    syncStatus === 'syncing' ? Colors.warning   : '#8aa0b0';

  const syncLabel =
    syncStatus === 'syncing' ? 'Synchronisation...' :
    syncStatus === 'success' ? 'Synchronisé'        :
    syncStatus === 'error'   ? 'Erreur de sync'     : 'Prêt';

  const renderProgramme = useCallback(({ item }: { item: ProgrammeAvecProgression }): React.ReactElement => (
    <View style={numColumns > 1 ? { flex: 1 } : undefined}>
      <ProgrammeCard
        item={item}
        onPress={() => navigation.navigate('Programme', { programmeId: item.id })}
      />
    </View>
  ), [navigation, numColumns]);

  return (
    <View style={styles.root}>

      <DashboardHeader user={user} syncDotColor={syncDotColor} syncLabel={syncLabel} />
      <NetworkBanner isConnected={isConnected} />
      <SyncCard lastSync={lastSync} pendingCount={pendingCount} syncing={syncing} onSync={handleSync} />

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Programmes en cours</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Historique')}>
          <Text style={styles.sectionLink}>Historique ›</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        key={numColumns}
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProgramme}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
        style={styles.flatList}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={handleSync} tintColor={Colors.brandBlue} />}
        ListEmptyComponent={<EmptyProgrammes syncing={syncing} onSync={handleSync} />}
      />

      <DashboardFooter
        devUnlocked={devUnlocked}
        onLogout={() => setShowLogoutDialog(true)}
        onDevTap={handleDevTap}
        onNavigateDebug={() => navigation.navigate('Debug')}
      />

      <DevPinOverlay
        visible={pinVisible}
        pinInput={pinInput}
        pinLoading={pinLoading}
        onChangePinInput={setPinInput}
        onCancel={() => { setPinVisible(false); setPinInput(''); }}
        onConfirm={checkPin}
      />

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
  root:         { flex: 1, backgroundColor: NEO },
  flatList:     { flex: 1 },
  list:         { paddingHorizontal: 14, paddingVertical: 6, paddingBottom: 12 },
  sectionRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginBottom: 10 },
  sectionTitle: { fontSize: scale(14), fontWeight: '700', color: TEXT2 },
  sectionLink:  { fontSize: scale(13), color: Colors.brandBlue, fontWeight: '600' },
});
