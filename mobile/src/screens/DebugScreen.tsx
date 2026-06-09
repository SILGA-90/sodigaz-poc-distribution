/**
 * Ecran de debug SQLite (accès protégé 7 taps + PIN serveur).
 * Affiche le nombre de lignes par table + état de synchronisation.
 * Design néomorphisme sombre — ambiance terminal.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { getDatabase, resetDatabase, getLastPulledAt } from '../db/database';
import { getTableCounts, TableCounts } from '../db/repositories/debugRepository';
import { countPending } from '../db/repositories/operationRepository';
import { Colors } from '../theme';

// ── Palette néomorphisme ─────────────────────────────────────────────────────
const BASE    = '#0d1e35';
const SURFACE = '#112240';
const DEEPER  = '#07111e';
const LIFT    = 'rgba(255,255,255,0.06)';
const INSET   = '#091527';

export default function DebugScreen(): React.ReactElement {
  const [counts, setCounts] = useState<TableCounts | null>(null);
  const [lastPull, setLastPull] = useState<number>(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [pending, setPending]   = useState<number>(0);

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
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function handleReset(): void {
    Alert.alert(
      'Réinitialiser la base ?',
      `Cette action supprime toutes les données locales (référentiels, programmes, opérations, photos).\n\nLes enregistrements PENDING non synchronisés seront perdus définitivement.\n\nPending actuels : ${pending}`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Réinitialiser', style: 'destructive', onPress: async () => {
          setLoading(true);
          try { await resetDatabase(); await refresh(); }
          catch (e: any) { setError(e?.message ?? String(e)); setLoading(false); }
        }},
      ],
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* ══ HEADER ══ */}
      <View style={styles.titleRow}>
        <View style={styles.dbIconOuter}>
          <View style={styles.dbIconBox}>
            <Text style={styles.dbIconText}>⊡</Text>
          </View>
        </View>
        <View>
          <Text style={styles.titleLabel}>Base de données locale</Text>
          <Text style={styles.titleSub}>SQLite · Debug</Text>
        </View>
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.brandBlue} />
          <Text style={styles.loadingText}>Lecture en cours…</Text>
        </View>
      )}

      {/* Erreur */}
      {error && (
        <View style={styles.alertOuter}>
          <View style={styles.alertError}>
            <Text style={styles.alertIcon}>✗</Text>
            <Text style={styles.alertText}>{error}</Text>
          </View>
        </View>
      )}

      {/* Succès init */}
      {counts && !loading && (
        <>
          <View style={styles.alertOuter}>
            <View style={styles.alertSuccess}>
              <Text style={styles.alertIcon}>✓</Text>
              <Text style={[styles.alertText, styles.alertTextSuccess]}>
                Base initialisée correctement.
              </Text>
            </View>
          </View>

          {/* Table des lignes */}
          <View style={styles.tableOuter}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableHeaderText}>Table</Text>
              <Text style={styles.tableHeaderText}>Lignes</Text>
            </View>
            {Object.entries(counts).map(([table, n], i) => (
              <View key={table} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                <Text style={styles.tableName}>{table}</Text>
                <View style={[styles.countBadge, (n as number) > 0 && styles.countBadgeActive]}>
                  <Text style={[(n as number) > 0 ? styles.countTextActive : styles.countText]}>
                    {String(n)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.meta}>
            Dernière sync : {lastPull === 0 ? 'jamais' : new Date(lastPull).toLocaleString('fr-FR')}
          </Text>
        </>
      )}

      {/* Pending */}
      {!loading && (
        <View style={styles.pendingOuter}>
          <View style={[styles.pendingBox, pending > 0 && styles.pendingBoxActive]}>
            <Text style={[styles.pendingIcon, pending > 0 && styles.pendingIconActive]}>↑</Text>
            <Text style={[styles.pendingText, pending > 0 && styles.pendingTextActive]}>
              {pending > 0
                ? `${pending} enregistrement(s) en attente de synchronisation`
                : 'Aucun enregistrement PENDING'}
            </Text>
          </View>
        </View>
      )}

      {/* Bouton rafraîchir */}
      <View style={styles.btnOuter}>
        <TouchableOpacity style={styles.btnRefresh} onPress={refresh} activeOpacity={0.85}>
          <View style={styles.btnSheen} pointerEvents="none" />
          <Text style={styles.btnText}>Rafraîchir</Text>
        </TouchableOpacity>
      </View>

      {/* Bouton réinitialiser */}
      <View style={styles.dangerBtnOuter}>
        <TouchableOpacity style={styles.btnDanger} onPress={handleReset} activeOpacity={0.85}>
          <Text style={styles.btnText}>Réinitialiser la base (debug)</Text>
          <Text style={styles.btnDangerSub}>Action irréversible · données PENDING perdues</Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BASE },
  scroll: { padding: 16, paddingBottom: 40 },

  // Titre
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22, marginTop: 8 },
  dbIconOuter: { borderRadius: 14, shadowColor: DEEPER, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.85, shadowRadius: 8, elevation: 5 },
  dbIconBox: { width: 52, height: 52, borderRadius: 14, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  dbIconText:  { fontSize: 24, color: Colors.brandBlue },
  titleLabel:  { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  titleSub:    { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' },

  loadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  loadingText: { fontSize: 13, color: 'rgba(255,255,255,0.35)' },

  // Alertes
  alertOuter:  { marginBottom: 12, borderRadius: 12, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 4 },
  alertError:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.25)' },
  alertSuccess:{ flexDirection: 'row', alignItems: 'center',     gap: 10, backgroundColor: 'rgba(52,211,153,0.1)',  borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)' },
  alertIcon:   { fontSize: 16 },
  alertText:   { flex: 1, fontSize: 13, color: '#f87171', lineHeight: 18 },
  alertTextSuccess: { color: '#34d399' },

  // Table
  tableOuter:  { borderRadius: 14, overflow: 'hidden', marginBottom: 14, shadowColor: DEEPER, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.85, shadowRadius: 10, elevation: 5 },
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: INSET, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopColor: 'rgba(0,0,0,0.4)', borderLeftColor: 'rgba(0,0,0,0.4)', borderRightColor: 'rgba(0,0,0,0.4)' },
  tableHeaderText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1, textTransform: 'uppercase' },
  tableRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: SURFACE },
  tableRowAlt: { backgroundColor: '#0f1e38' },
  tableName:   { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', flex: 1, marginRight: 8 },
  countBadge:  { backgroundColor: INSET, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, minWidth: 34, alignItems: 'center' },
  countBadgeActive: { backgroundColor: 'rgba(7,155,217,0.15)' },
  countText:   { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' },
  countTextActive: { fontSize: 13, fontWeight: '700', color: Colors.brandBlue, fontFamily: 'monospace' },

  meta: { fontSize: 12, color: 'rgba(255,255,255,0.25)', marginBottom: 16, fontStyle: 'italic', textAlign: 'center' },

  // Pending
  pendingOuter: { marginBottom: 16, borderRadius: 12, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 4 },
  pendingBox:   { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, backgroundColor: 'rgba(52,211,153,0.08)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.2)' },
  pendingBoxActive: { backgroundColor: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.3)' },
  pendingIcon:  { fontSize: 18, color: '#34d399' },
  pendingIconActive: { color: '#fbbf24' },
  pendingText:  { flex: 1, fontSize: 13, color: 'rgba(52,211,153,0.8)', fontWeight: '600' },
  pendingTextActive: { color: '#fbbf24' },

  // Boutons
  btnOuter:      { marginBottom: 10, borderRadius: 12, shadowColor: Colors.brandBlue, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 12, elevation: 8 },
  btnRefresh:    { backgroundColor: Colors.brandBlue, borderRadius: 12, paddingVertical: 14, alignItems: 'center', overflow: 'hidden' },
  btnSheen:      { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.1)', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  dangerBtnOuter:{ marginBottom: 12, borderRadius: 12, shadowColor: '#991b1b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
  btnDanger:     { backgroundColor: 'rgba(220,38,38,0.15)', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(220,38,38,0.4)' },
  btnText:       { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDangerSub:  { color: 'rgba(248,113,113,0.5)', fontSize: 11, marginTop: 4 },
});
