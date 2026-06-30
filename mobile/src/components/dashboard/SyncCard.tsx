import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import { SURFACE, TEXT, TEXT3 } from './dashStyles';

/** Formate un timestamp ms en durée relative en français. */
export function formatRelativeTime(ts: number): string {
  if (ts === 0) return 'jamais';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1)  return 'à l\'instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `il y a ${diffH}h`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

interface Props {
  lastSync:     number;
  pendingCount: number;
  syncing:      boolean;
  onSync:       () => void;
}

export default function SyncCard({ lastSync, pendingCount, syncing, onSync }: Props): React.ReactElement {
  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <View style={styles.left}>
          <Text style={styles.label}>Dernière synchronisation</Text>
          <Text style={styles.value}>{formatRelativeTime(lastSync)}</Text>
        </View>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>{pendingCount} en attente</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.btn, syncing && { opacity: 0.55 }]}
          onPress={onSync}
          disabled={syncing}
          activeOpacity={0.82}
        >
          {syncing
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.btnText}>↑  Sync</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginTop: 14, marginBottom: 12,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: '#DDE2E6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  content: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, gap: 10,
  },
  left:  { flex: 1 },
  label: { fontSize: scale(11), color: TEXT3, fontWeight: '500' },
  value: { fontSize: scale(15), color: TEXT,  fontWeight: '700', marginTop: 2 },

  pendingBadge: { backgroundColor: Colors.warningBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: Colors.warningBorder },
  pendingText:  { fontSize: scale(11), color: Colors.warning, fontWeight: '700' },

  btn: {
    borderRadius: 20,
    backgroundColor: Colors.brandBlue,
    paddingVertical: 10, paddingHorizontal: 16,
    minHeight: 40, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: scale(13) },
});
