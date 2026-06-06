/**
 * Ecran d'accueil apres connexion.
 * Sprint 2.2 : bouton de synchronisation + liste des programmes recuperes.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
import { getLastPulledAt } from '../db/database';
import { UtilisateurInfo } from '../types/auth';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

export default function DashboardScreen({ navigation }: Props): React.ReactElement {
  const [user, setUser] = useState<UtilisateurInfo | null>(null);
  const [programmes, setProgrammes] = useState<ProgrammeAvecProgression[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<number>(0);

  const loadLocalData = useCallback(async () => {
    const progs = await getProgrammesRecents();
    setProgrammes(progs);
    const lp = await getLastPulledAt();
    setLastSync(lp);
  }, []);

  useEffect(() => {
    fetchMe().then(setUser).catch(() => {});
    loadLocalData();
  }, [loadLocalData]);

  async function handleSync(): Promise<void> {
    setSyncing(true);
    try {
      const { pull: pullRes, push: pushRes } = await syncAll();
      await loadLocalData();

      if (!pullRes.success) {
        Alert.alert('Echec du pull', pullRes.error ?? 'Erreur inconnue');
        return;
      }
      if (!pushRes.success) {
        Alert.alert('Echec du push', pushRes.error ?? 'Erreur inconnue');
        return;
      }

      const recus = Object.values(pullRes.counts).reduce((a, b) => a + b, 0);
      const envoyes =
        pushRes.pushed.operation +
        pushRes.pushed.ligne_operation +
        pushRes.pushed.anomalie;

      Alert.alert(
        'Synchronisation reussie',
        `Recus du serveur : ${recus}\n` +
        `  - Programmes : ${pullRes.counts.programme ?? 0}\n` +
        `  - Etapes : ${pullRes.counts.etape ?? 0}\n\n` +
        `Envoyes au serveur : ${envoyes}\n` +
        `  - Operations : ${pushRes.pushed.operation}\n` +
        `  - Lignes : ${pushRes.pushed.ligne_operation}\n` +
        `  - Anomalies : ${pushRes.pushed.anomalie}`,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await logout();
    navigation.replace('Login');
  }

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
      <View style={styles.header}>
        <Text style={styles.welcomeSmall}>Bonjour,</Text>
        <Text style={styles.welcomeBig}>
          {user ? `${user.first_name} ${user.last_name}` : '...'}
        </Text>
        <Text style={styles.subtitle}>
          {user?.code_livreur ?? ''}
        </Text>
      </View>

      <View style={styles.syncBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.syncLabel}>Derniere synchronisation</Text>
          <Text style={styles.syncValue}>
            {lastSync === 0 ? 'jamais' : new Date(lastSync).toLocaleString('fr-FR')}
          </Text>
        </View>
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

      <Text style={styles.sectionTitle}>Mes programmes</Text>

      <FlatList
        data={programmes}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderProgramme}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={handleSync} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Aucun programme en local.{'\n'}
              Appuie sur "Synchroniser" pour recuperer ton programme du jour.
            </Text>
          </View>
        }
      />

      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.footerText}>Deconnexion</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.debugLink}
        onPress={() => navigation.navigate('Debug')}
      >
        <Text style={styles.debugLinkText}>Debug BDD</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#0d6efd', padding: 20, paddingTop: 44 },
  welcomeSmall: { color: '#cbe2ff', fontSize: 14 },
  welcomeBig: { color: '#fff', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#cbe2ff', fontSize: 14, marginTop: 2 },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 12,
    padding: 14,
    borderRadius: 10,
  },
  syncLabel: { fontSize: 12, color: '#888' },
  syncValue: { fontSize: 14, color: '#333', fontWeight: '600' },
  syncButton: {
    backgroundColor: '#0d6efd',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: {
    fontSize: 16, fontWeight: '700', color: '#333',
    marginHorizontal: 16, marginTop: 4, marginBottom: 8,
  },
  list: { paddingHorizontal: 12, paddingBottom: 12 },
  progCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    marginBottom: 10,
  },
  progHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progNumero: { fontSize: 15, fontWeight: '700', color: '#333' },
  badgesRow: { flexDirection: 'row', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeCollecte: { backgroundColor: '#cfe2ff' },
  badgeRestitution: { backgroundColor: '#d1e7dd' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#333' },
  progDate: { color: '#aaa', fontSize: 12, marginTop: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  progressBar: {
    flex: 1, height: 6, backgroundColor: '#e9ecef',
    borderRadius: 3, overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3 },
  progProgress: { fontSize: 12, fontWeight: '700', minWidth: 70, textAlign: 'right' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#888', textAlign: 'center', lineHeight: 22 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  logoutButton: { padding: 14, alignItems: 'center', backgroundColor: '#dc3545' },
  footerText: { color: '#fff', fontWeight: '600' },
  debugLink: { padding: 8, alignItems: 'center' },
  debugLinkText: { color: '#ccc', fontSize: 11 },
});
