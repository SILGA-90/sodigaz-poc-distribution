/**
 * Recapitulatif d'une etape deja visitee.
 * Affiche l'operation enregistree (produits, montant, signatures, statut sync).
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getDatabase } from '../db/database';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EtapeDetail'>;

interface OperationLocale {
  uuid: string;
  type_operation: string;
  sous_type: string | null;
  date_heure: string;
  mode_paiement: string | null;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: number;
  nom_signataire_client: string;
  commentaire: string;
  sync_status: string;
  signature_livreur: string;
  signature_client: string;
}

interface LigneLocale {
  produit_code_x3: string;
  quantite_realisee: number;
  montant_ligne: number;
}

export default function EtapeDetailScreen({ route, navigation }: Props): React.ReactElement {
  const { etapeUuid } = route.params;
  const [operation, setOperation] = useState<OperationLocale | null>(null);
  const [lignes, setLignes] = useState<LigneLocale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      const op = await db.getFirstAsync<OperationLocale>(
        `SELECT * FROM operation WHERE etape_uuid = ? AND is_deleted = 0 ORDER BY last_modified DESC LIMIT 1;`,
        [etapeUuid],
      );
      if (op) {
        setOperation(op);
        const ls = await db.getAllAsync<LigneLocale>(
          `SELECT produit_code_x3, quantite_realisee, montant_ligne
           FROM ligne_operation WHERE operation_uuid = ? AND is_deleted = 0;`,
          [op.uuid],
        );
        setLignes(ls);
      }
      setLoading(false);
    })();
  }, [etapeUuid]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#0d6efd" /></View>;
  }

  if (!operation) {
    return (
      <View style={styles.center}>
        <Text style={styles.noOpText}>Aucune operation enregistree pour cette etape.</Text>
      </View>
    );
  }

  const synced = operation.sync_status === 'SYNCED';
  const dateStr = new Date(operation.date_heure).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* En-tete */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.typeOp}>{operation.type_operation}</Text>
          <View style={[styles.syncBadge, synced ? styles.syncedBg : styles.pendingBg]}>
            <Text style={styles.syncBadgeText}>{synced ? 'Synchronisee' : 'En attente sync'}</Text>
          </View>
        </View>
        <Text style={styles.date}>{dateStr}</Text>
        {operation.sous_type && (
          <Text style={styles.sousType}>{operation.sous_type}</Text>
        )}
      </View>

      {/* Produits */}
      <Text style={styles.sectionTitle}>Produits</Text>
      <View style={styles.card}>
        {lignes.length === 0 ? (
          <Text style={styles.emptyText}>Aucune ligne enregistree.</Text>
        ) : (
          lignes.map((l) => (
            <View key={l.produit_code_x3} style={styles.ligneRow}>
              <Text style={styles.ligneCode}>{l.produit_code_x3}</Text>
              <Text style={styles.ligneQte}>x{l.quantite_realisee}</Text>
              <Text style={styles.ligneMontant}>
                {l.montant_ligne.toLocaleString('fr-FR')} FCFA
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Paiement */}
      <Text style={styles.sectionTitle}>Paiement</Text>
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Montant total</Text>
          <Text style={styles.infoValue}>
            {operation.montant_total.toLocaleString('fr-FR')} FCFA
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Encaisse</Text>
          <Text style={[styles.infoValue, { color: operation.est_encaissee ? '#198754' : '#dc3545' }]}>
            {operation.est_encaissee
              ? `${operation.montant_encaisse.toLocaleString('fr-FR')} FCFA`
              : 'Non encaisse'}
          </Text>
        </View>
        {operation.mode_paiement && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Mode</Text>
            <Text style={styles.infoValue}>{operation.mode_paiement}</Text>
          </View>
        )}
      </View>

      {/* Signatures */}
      <Text style={styles.sectionTitle}>Signatures</Text>
      <View style={styles.card}>
        {operation.nom_signataire_client ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Signataire client</Text>
            <Text style={styles.infoValue}>{operation.nom_signataire_client}</Text>
          </View>
        ) : null}
        <View style={styles.sigRow}>
          <View style={[styles.sigChip, operation.signature_livreur ? styles.sigOk : styles.sigMissing]}>
            <Text style={styles.sigChipText}>
              {operation.signature_livreur ? 'Livreur signe' : 'Livreur non signe'}
            </Text>
          </View>
          <View style={[styles.sigChip, operation.signature_client ? styles.sigOk : styles.sigMissing]}>
            <Text style={styles.sigChipText}>
              {operation.signature_client ? 'Client signe' : 'Client non signe'}
            </Text>
          </View>
        </View>
      </View>

      {/* Commentaire */}
      {operation.commentaire ? (
        <>
          <Text style={styles.sectionTitle}>Commentaire</Text>
          <View style={styles.card}>
            <Text style={styles.commentaire}>{operation.commentaire}</Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  noOpText: { color: '#888', textAlign: 'center' },
  header: { backgroundColor: '#0d6efd', padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeOp: { color: '#fff', fontSize: 18, fontWeight: '700' },
  syncBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  syncedBg: { backgroundColor: '#198754' },
  pendingBg: { backgroundColor: '#ffc107' },
  syncBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  date: { color: '#cbe2ff', fontSize: 13, marginTop: 4 },
  sousType: { color: '#cbe2ff', fontSize: 12, marginTop: 2 },
  sectionTitle: {
    fontSize: 14, fontWeight: '700', color: '#555',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  card: {
    backgroundColor: '#fff', marginHorizontal: 12,
    borderRadius: 10, padding: 14,
  },
  ligneRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  ligneCode: { flex: 1, fontSize: 13, color: '#333', fontWeight: '600' },
  ligneQte: { fontSize: 13, color: '#666', marginRight: 12 },
  ligneMontant: { fontSize: 13, fontWeight: '700', color: '#0d6efd' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  infoLabel: { fontSize: 13, color: '#888' },
  infoValue: { fontSize: 13, fontWeight: '700', color: '#333' },
  sigRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  sigChip: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  sigOk: { backgroundColor: '#d1e7dd' },
  sigMissing: { backgroundColor: '#f8d7da' },
  sigChipText: { fontSize: 12, fontWeight: '600', color: '#333' },
  emptyText: { color: '#aaa', fontSize: 13 },
  commentaire: { fontSize: 13, color: '#555', lineHeight: 20 },
});
