/**
 * Ecran de debug (temporaire, Sprint 2.1).
 * Affiche le nombre de lignes par table SQLite locale.
 * Permet de verifier que la base s'initialise et se remplira a la sync.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { getDatabase, resetDatabase, getLastPulledAt } from '../db/database';
import { getTableCounts, TableCounts } from '../db/repositories/debugRepository';
import { countPending } from '../db/repositories/operationRepository';

export default function DebugScreen(): React.ReactElement {
  const [counts, setCounts] = useState<TableCounts | null>(null);
  const [lastPull, setLastPull] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number>(0);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await getDatabase(); // force l'init
      const c = await getTableCounts();
      const lp = await getLastPulledAt();
      const p = await countPending();
      setCounts(c);
      setLastPull(lp);
      setPending(p);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleReset(): Promise<void> {
    setLoading(true);
    try {
      await resetDatabase();
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Base de donnees locale (SQLite)</Text>

      {loading && <ActivityIndicator size="large" color="#1a7fba" />}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Erreur : {error}</Text>
        </View>
      )}

      {counts && !loading && (
        <>
          <View style={styles.successBox}>
            <Text style={styles.successText}>
              Base initialisee correctement.
            </Text>
          </View>

          <View style={styles.table}>
            {Object.entries(counts).map(([table, n]) => (
              <View key={table} style={styles.row}>
                <Text style={styles.tableName}>{table}</Text>
                <Text style={styles.tableCount}>{n}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.meta}>
            Derniere synchronisation : {lastPull === 0 ? 'jamais' : new Date(lastPull).toLocaleString('fr-FR')}
          </Text>
        </>
      )}

      <View style={styles.pendingBox}>
        <Text style={styles.pendingText}>
          En attente de synchronisation (PENDING) : {pending}
        </Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={refresh}>
        <Text style={styles.buttonText}>Rafraichir</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={handleReset}>
        <Text style={styles.buttonText}>Reinitialiser la base (debug)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 16, color: '#333' },
  errorBox: { backgroundColor: '#f8d7da', padding: 12, borderRadius: 8, marginBottom: 12 },
  errorText: { color: '#842029' },
  successBox: { backgroundColor: '#d1e7dd', padding: 12, borderRadius: 8, marginBottom: 12 },
  successText: { color: '#0f5132', fontWeight: '600' },
  table: { backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tableName: { fontSize: 14, color: '#333', fontFamily: 'monospace', flex: 1, marginRight: 8 },
  tableCount: { fontSize: 14, fontWeight: '700', color: '#1a7fba', flexShrink: 0 },
  meta: { fontSize: 13, color: '#666', marginBottom: 16, fontStyle: 'italic' },
  button: {
    backgroundColor: '#1a7fba',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDanger: { backgroundColor: '#dc3545' },
  pendingBox: { backgroundColor: '#fff3cd', padding: 12, borderRadius: 8, marginBottom: 12 },
  pendingText: { color: '#664d03', fontWeight: '600', textAlign: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
