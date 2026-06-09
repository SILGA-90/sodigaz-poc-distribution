/**
 * Recapitulatif d'une etape deja visitee.
 * Affiche l'operation enregistree (produits, montant, signatures, statut sync).
 * Design néomorphisme sombre — lecture seule.
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
import { Colors } from '../theme';

// ── Palette néomorphisme ─────────────────────────────────────────────────────
const BASE    = '#0d1e35';
const SURFACE = '#112240';
const DEEPER  = '#07111e';
const LIFT    = 'rgba(255,255,255,0.06)';
const INSET   = '#091527';

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

export default function EtapeDetailScreen({ route }: Props): React.ReactElement {
  const { etapeUuid } = route.params;
  const [operation, setOperation] = useState<OperationLocale | null>(null);
  const [lignes, setLignes]       = useState<LigneLocale[]>([]);
  const [loading, setLoading]     = useState(true);

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
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;
  }

  if (!operation) {
    return (
      <View style={styles.center}>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>○</Text>
          <Text style={styles.emptyTitle}>Aucune opération</Text>
          <Text style={styles.emptyText}>Cette étape ne possède pas encore d'opération enregistrée.</Text>
        </View>
      </View>
    );
  }

  const synced  = operation.sync_status === 'SYNCED';
  const isCollecte = operation.type_operation === 'COLLECTE';
  const dateStr = new Date(operation.date_heure).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* ══ HEADER ══ */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>

          {/* Chip type opération */}
          <View style={[styles.typeChip, isCollecte ? styles.typeChipCollecte : styles.typeChipRestit]}>
            <Text style={styles.typeChipText}>{isCollecte ? 'Collecte' : 'Restitution'}</Text>
          </View>
          {operation.sous_type && (
            <Text style={styles.sousType}>{operation.sous_type}</Text>
          )}
          <Text style={styles.dateText}>{dateStr}</Text>

          {/* Badge sync — néomorphe */}
          <View style={styles.syncPillOuter}>
            <View style={[styles.syncPill, synced ? styles.syncPillSynced : styles.syncPillPending]}>
              <View style={[styles.syncDot, synced ? styles.syncDotSynced : styles.syncDotPending]} />
              <Text style={[styles.syncPillText, synced ? styles.syncTextSynced : styles.syncTextPending]}>
                {synced ? 'Synchronisée' : 'En attente de sync'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ══ PRODUITS ══ */}
      <SectionHeader icon="↓" color={isCollecte ? 'blue' : 'green'} title="Produits" />
      <View style={styles.cardOuter}>
        <View style={styles.card}>
          {lignes.length === 0 ? (
            <Text style={styles.emptyRowText}>Aucune ligne enregistrée.</Text>
          ) : (
            lignes.map((l, index) => (
              <View key={`${l.produit_code_x3}_${index}`}
                style={[styles.ligneRow, index > 0 && styles.ligneRowSep]}>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeText}>{l.produit_code_x3}</Text>
                </View>
                <Text style={styles.ligneQte}>× {l.quantite_realisee}</Text>
                <Text style={styles.ligneMontant}>
                  {l.montant_ligne > 0 ? `${l.montant_ligne.toLocaleString('fr-FR')} FCFA` : '—'}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      {/* ══ PAIEMENT ══ */}
      <SectionHeader icon="$" color="green" title="Paiement" />
      <View style={styles.cardOuter}>
        <View style={styles.card}>
          {/* Montant total — mis en valeur */}
          <View style={styles.montantHeroRow}>
            <Text style={styles.montantHeroValue}>
              {operation.montant_total.toLocaleString('fr-FR')}
            </Text>
            <Text style={styles.montantHeroUnit}> FCFA</Text>
          </View>
          <View style={styles.fieldSep} />

          <InfoRow label="Encaissé" value={
            operation.est_encaissee
              ? `${operation.montant_encaisse.toLocaleString('fr-FR')} FCFA`
              : 'Non encaissé'
          } valueColor={operation.est_encaissee ? '#34d399' : '#f87171'} />

          {operation.mode_paiement && (
            <>
              <View style={styles.fieldSep} />
              <InfoRow label="Mode de paiement" value={modePaiementLabel(operation.mode_paiement)} />
            </>
          )}
        </View>
      </View>

      {/* ══ SIGNATURES ══ */}
      <SectionHeader icon="✎" color="navy" title="Signatures" />
      <View style={styles.cardOuter}>
        <View style={styles.card}>
          {operation.nom_signataire_client ? (
            <>
              <InfoRow label="Signataire client" value={operation.nom_signataire_client} />
              <View style={styles.fieldSep} />
            </>
          ) : null}
          <View style={styles.sigRow}>
            <SigChip label="Livreur" signed={!!operation.signature_livreur} />
            <SigChip label="Client"  signed={!!operation.signature_client} />
          </View>
        </View>
      </View>

      {/* ══ COMMENTAIRE ══ */}
      {operation.commentaire ? (
        <>
          <SectionHeader icon="≡" color="gray" title="Commentaire" />
          <View style={styles.cardOuter}>
            <View style={styles.card}>
              <View style={styles.commentaireBox}>
                <Text style={styles.commentaire}>{operation.commentaire}</Text>
              </View>
            </View>
          </View>
        </>
      ) : null}

    </ScrollView>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────

type IconColor = 'blue' | 'green' | 'orange' | 'navy' | 'gray';
function SectionHeader({ icon, color, title }: { icon: string; color: IconColor; title: string }) {
  const bg: Record<IconColor, string> = {
    blue:   'rgba(7,155,217,0.15)',
    green:  'rgba(52,211,153,0.15)',
    orange: 'rgba(238,114,2,0.15)',
    navy:   'rgba(255,255,255,0.08)',
    gray:   'rgba(148,163,184,0.12)',
  };
  const fg: Record<IconColor, string> = {
    blue:   Colors.brandBlue,
    green:  '#34d399',
    orange: Colors.brandOrange,
    navy:   'rgba(255,255,255,0.7)',
    gray:   '#94a3b8',
  };
  return (
    <View style={shStyles.row}>
      <View style={shStyles.iconOuter}>
        <View style={[shStyles.iconBox, { backgroundColor: bg[color] }]}>
          <Text style={[shStyles.iconText, { color: fg[color] }]}>{icon}</Text>
        </View>
      </View>
      <Text style={shStyles.title}>{title}</Text>
    </View>
  );
}
const shStyles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 22, marginBottom: 8 },
  iconOuter:{ borderRadius: 10, shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 5, elevation: 4 },
  iconBox:  { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: LIFT, borderLeftColor: LIFT, borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  iconText: { fontSize: 14, fontWeight: '800' },
  title:    { fontSize: 14, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: -0.2 },
});

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={irStyles.row}>
      <Text style={irStyles.label}>{label}</Text>
      <Text style={[irStyles.value, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}
const irStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  value: { fontSize: 13, fontWeight: '700', color: '#fff' },
});

function SigChip({ label, signed }: { label: string; signed: boolean }) {
  return (
    <View style={[
      scStyles.chipOuter,
      signed ? scStyles.chipOuterSigned : scStyles.chipOuterUnsigned,
    ]}>
      <View style={[scStyles.chip, signed ? scStyles.chipSigned : scStyles.chipUnsigned]}>
        <Text style={[scStyles.icon, signed ? scStyles.iconSigned : scStyles.iconUnsigned]}>
          {signed ? '✓' : '✗'}
        </Text>
        <Text style={[scStyles.label, signed ? scStyles.labelSigned : scStyles.labelUnsigned]}>
          {label}
        </Text>
        <Text style={[scStyles.sub, signed ? scStyles.subSigned : scStyles.subUnsigned]}>
          {signed ? 'Signé' : 'Non signé'}
        </Text>
      </View>
    </View>
  );
}
const scStyles = StyleSheet.create({
  chipOuter:        { flex: 1, borderRadius: 12 },
  chipOuterSigned:  { shadowColor: '#065f46', shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.6, shadowRadius: 6, elevation: 4 },
  chipOuterUnsigned:{ shadowColor: DEEPER,    shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.85, shadowRadius: 6, elevation: 4 },
  chip:        { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1 },
  chipSigned:  { backgroundColor: 'rgba(52,211,153,0.12)', borderColor: 'rgba(52,211,153,0.35)' },
  chipUnsigned:{ backgroundColor: INSET,                  borderColor: 'rgba(248,113,113,0.25)' },
  icon:         { fontSize: 18, marginBottom: 4 },
  iconSigned:   { color: '#34d399' },
  iconUnsigned: { color: '#f87171' },
  label:        { fontSize: 13, fontWeight: '700' },
  labelSigned:  { color: '#34d399' },
  labelUnsigned:{ color: '#f87171' },
  sub:         { fontSize: 10, marginTop: 2 },
  subSigned:   { color: 'rgba(52,211,153,0.6)' },
  subUnsigned: { color: 'rgba(248,113,113,0.5)' },
});

function modePaiementLabel(mode: string): string {
  const MAP: Record<string, string> = {
    ESPECES: 'Espèces', MOBILE_MONEY: 'Mobile Money', CHEQUE: 'Chèque',
    VIREMENT: 'Virement', CREDIT: 'Crédit',
  };
  return MAP[mode] ?? mode;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BASE },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BASE, padding: 32 },

  // État vide
  emptyBox:  { alignItems: 'center', gap: 10 },
  emptyIcon: { fontSize: 40, color: 'rgba(255,255,255,0.12)' },
  emptyTitle:{ fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  emptyText: { fontSize: 13, color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 20 },

  // Header
  header: { backgroundColor: BASE, overflow: 'hidden' },
  bubble1:{ position: 'absolute', width: 180, height: 180, borderRadius: 90, top: -50, right: -40, backgroundColor: 'rgba(7,155,217,0.08)' },
  bubble2:{ position: 'absolute', width: 90,  height: 90,  borderRadius: 45, top: 50,  right: 110, backgroundColor: 'rgba(7,155,217,0.05)' },
  headerContent: { padding: 16, paddingBottom: 20 },

  typeChip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 6, borderWidth: 1 },
  typeChipCollecte: { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  typeChipRestit:   { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: 12, fontWeight: '700', color: '#e2e8f0' },
  sousType: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 },
  dateText: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 12 },

  syncPillOuter: { alignSelf: 'flex-start', borderRadius: 20,
    shadowColor: DEEPER, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.8, shadowRadius: 5, elevation: 4 },
  syncPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: LIFT, borderLeftColor: LIFT,
    borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)' },
  syncPillSynced:  { backgroundColor: 'rgba(52,211,153,0.12)' },
  syncPillPending: { backgroundColor: 'rgba(251,191,36,0.12)' },
  syncDot:         { width: 7, height: 7, borderRadius: 4 },
  syncDotSynced:   { backgroundColor: '#34d399' },
  syncDotPending:  { backgroundColor: '#fbbf24' },
  syncPillText:    { fontSize: 12, fontWeight: '700' },
  syncTextSynced:  { color: '#34d399' },
  syncTextPending: { color: '#fbbf24' },

  // Cards
  cardOuter: {
    marginHorizontal: 12, marginBottom: 4,
    borderRadius: 16, shadowColor: DEEPER,
    shadowOffset: { width: 6, height: 6 }, shadowOpacity: 0.85, shadowRadius: 12, elevation: 6,
  },
  card: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: LIFT, borderLeftColor: LIFT,
    borderBottomColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(0,0,0,0.2)',
  },
  fieldSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 8 },

  // Lignes produits
  ligneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  ligneRowSep: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  codeBadge: { backgroundColor: 'rgba(7,155,217,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.brandBlue },
  ligneQte:     { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  ligneMontant: { fontSize: 14, fontWeight: '700', color: '#fff' },
  emptyRowText: { color: 'rgba(255,255,255,0.25)', fontSize: 13 },

  // Montant héro
  montantHeroRow:  { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 8 },
  montantHeroValue:{ fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  montantHeroUnit: { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },

  // Commentaire
  commentaireBox: {
    backgroundColor: INSET, borderRadius: 10, padding: 12,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.4)', borderLeftColor: 'rgba(0,0,0,0.4)',
    borderBottomColor: 'rgba(255,255,255,0.04)', borderRightColor: 'rgba(255,255,255,0.04)',
  },
  commentaire: { fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 22 },

  // Sig row
  sigRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
