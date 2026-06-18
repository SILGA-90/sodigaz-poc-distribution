import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import { NEO, TEXT, TEXT3 } from './dashStyles';

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
    <View style={styles.outer}>
      <View style={styles.shadowLight}>
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
          <View style={[styles.btnOuter, syncing && { opacity: 0.55 }]}>
            <TouchableOpacity style={styles.btnInner} onPress={onSync} disabled={syncing} activeOpacity={0.82}>
              {syncing
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnText}>↑  Sync</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginHorizontal: 16, marginTop: 14, marginBottom: 12,
    borderRadius: 16, backgroundColor: NEO,
    shadowColor: '#4a6880', shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  shadowLight: {
    borderRadius: 16, backgroundColor: NEO,
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 }, shadowOpacity: 1, shadowRadius: 7,
  },
  content: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, backgroundColor: NEO, padding: 16, gap: 10,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.85)', borderLeftColor: 'rgba(255,255,255,0.85)',
    borderBottomColor: 'rgba(74,104,128,0.35)', borderRightColor: 'rgba(74,104,128,0.35)',
  },
  left:  { flex: 1 },
  label: { fontSize: scale(11), color: TEXT3, fontWeight: '500' },
  value: { fontSize: scale(15), color: TEXT,  fontWeight: '700', marginTop: 2 },

  pendingBadge: { backgroundColor: Colors.warningBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: Colors.warningBorder },
  pendingText:  { fontSize: scale(11), color: Colors.warning, fontWeight: '700' },

  btnOuter: {
    borderRadius: 20, backgroundColor: Colors.brandBlue,
    shadowColor: '#02405a', shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6,
  },
  btnInner: {
    borderRadius: 20, backgroundColor: Colors.brandBlue,
    paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center',
    shadowColor: '#60d4ff', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.4, shadowRadius: 6,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#2bb8ef', borderLeftColor: '#2bb8ef',
    borderBottomColor: '#046a96', borderRightColor: '#046a96',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: scale(13) },
});
