/**
 * Récapitulatif d'une étape déjà visitée : vue lecture seule.
 *
 * Affiche le détail d'une opération associée à une étape visitée :
 * type, sous-type, articles (quantités réalisées), montants, paiement,
 * GPS (qualité + coordonnées), commentaire. Accessible depuis
 * ProgrammeScreen en appuyant sur une étape à statut VISITEE.
 *
 * Une fois soumise localement, une opération ne peut
 * pas être modifiée si elle est déjà SYNCED. Si elle est encore PENDING,
 * le livreur peut rouvrir SaisieOperationScreen pour la corriger :
 * l'upsert dans enregistrerOperation() gérera la mise à jour.
 * Cet écran ne propose pas de bouton "Modifier" pour éviter la confusion.
 *
 * WHY (requête directe sur getDatabase()) : Cet écran lit des données de
 * plusieurs tables (operation, ligne_operation, etape, plv, client)
 * qui ne sont pas exposées par un repository dédié. La requête SQL
 * directe est plus appropriée que de créer un repository pour une
 * seule utilisation.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getDatabase } from '../db/database';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

/* Palette néo claire */
const NEO     = '#e8edf2';
const NEO_SHD = '#4a6880';
const NEO_IN  = '#d4dde6';
const NAVY    = '#0a1628';
const TEXT    = '#1a2a3a';
const TEXT2   = '#3a5060';
const TEXT3   = '#3a5060';
const SEP     = '#c8d4de';

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
        <View style={styles.emptyOuter}>
          <View style={styles.emptyInner}>
            <Ionicons name="document-outline" size={36} color={TEXT3} style={{ marginBottom: 10 }} />
            <Text style={styles.emptyTitle}>Aucune opération</Text>
            <Text style={styles.emptyText}>Cette étape ne possède pas encore d'opération enregistrée.</Text>
          </View>
        </View>
      </View>
    );
  }

  const synced     = operation.sync_status === 'SYNCED';
  const isCollecte = operation.type_operation === 'COLLECTE';
  const dateStr    = new Date(operation.date_heure).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* Header navy */}
      <View style={styles.header}>
        <View style={styles.bubble1} pointerEvents="none" />
        <View style={styles.bubble2} pointerEvents="none" />
        <View style={styles.headerContent}>
          <View style={styles.headerTopRow}>
            <View style={[styles.typeChip, isCollecte ? styles.typeChipC : styles.typeChipR]}>
              <Text style={styles.typeChipText}>{isCollecte ? 'Collecte' : 'Restitution'}</Text>
            </View>
            {/* Badge sync */}
            <View style={[styles.syncPill, synced ? styles.syncPillSynced : styles.syncPillPending]}>
              <View style={[styles.syncDot, { backgroundColor: synced ? Colors.success : Colors.warning }]} />
              <Text style={[styles.syncPillText, { color: synced ? Colors.success : Colors.warning }]}>
                {synced ? 'Synchronisée' : 'En attente'}
              </Text>
            </View>
          </View>
          {operation.sous_type && (
            <Text style={styles.sousType}>{operation.sous_type}</Text>
          )}
          <Text style={styles.dateText}>{dateStr}</Text>
        </View>
      </View>

      {/* PRODUITS */}
      <SectionHeader icon={isCollecte ? 'arrow-down-outline' : 'arrow-up-outline'} color={isCollecte ? 'blue' : 'green'} title="Produits" />
      <View style={styles.cardOuter}>
        <View style={styles.cardInner}>
          {lignes.length === 0 ? (
            <Text style={styles.emptyRowText}>Aucune ligne enregistrée.</Text>
          ) : (
            lignes.map((l, index) => (
              <View key={`${l.produit_code_x3}_${index}`} style={[styles.ligneRow, index > 0 && styles.ligneRowSep]}>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeText}>{l.produit_code_x3}</Text>
                </View>
                <Text style={styles.ligneQte}>× {l.quantite_realisee}</Text>
                <Text style={styles.ligneMontant}>
                  {l.montant_ligne > 0 ? `${l.montant_ligne.toLocaleString('fr-FR')} FCFA` : ':'}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      {/* PAIEMENT */}
      <SectionHeader icon="cash-outline" color="green" title="Paiement" />
      <View style={styles.cardOuter}>
        <View style={styles.cardInner}>
          <View style={styles.montantHeroRow}>
            <Text style={styles.montantHeroValue}>{operation.montant_total.toLocaleString('fr-FR')}</Text>
            <Text style={styles.montantHeroUnit}> FCFA</Text>
          </View>
          <View style={styles.fieldSep} />
          <InfoRow
            label="Encaissé"
            value={operation.est_encaissee ? `${operation.montant_encaisse.toLocaleString('fr-FR')} FCFA` : 'Non encaissé'}
            valueColor={operation.est_encaissee ? Colors.success : Colors.danger}
          />
          {operation.mode_paiement && (
            <>
              <View style={styles.fieldSep} />
              <InfoRow label="Mode de paiement" value={modePaiementLabel(operation.mode_paiement)} />
            </>
          )}
        </View>
      </View>

      {/* SIGNATURES */}
      <SectionHeader icon="create-outline" color="navy" title="Signatures" />
      <View style={styles.cardOuter}>
        <View style={styles.cardInner}>
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

      {/* COMMENTAIRE */}
      {operation.commentaire ? (
        <>
          <SectionHeader icon="chatbubble-outline" color="gray" title="Commentaire" />
          <View style={styles.cardOuter}>
            <View style={styles.cardInner}>
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

/* Sous-composants */

type IconColor = 'blue' | 'green' | 'orange' | 'navy' | 'gray';
function SectionHeader({ icon, color, title }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: IconColor; title: string }) {
  const bg: Record<IconColor, string> = { blue: Colors.infoBg, green: Colors.successBg, orange: Colors.warningBg, navy: NEO_IN, gray: NEO_IN };
  const fg: Record<IconColor, string> = { blue: Colors.brandBlue, green: Colors.success, orange: Colors.brandOrange, navy: TEXT2, gray: TEXT3 };
  return (
    <View style={shS.row}>
      <View style={[shS.iconBox, { backgroundColor: bg[color] }]}>
        <Ionicons name={icon} size={16} color={fg[color]} />
      </View>
      <Text style={shS.title}>{title}</Text>
    </View>
  );
}
const shS = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 22, marginBottom: 8 },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: 15, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
});

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={irS.row}>
      <Text style={irS.label}>{label}</Text>
      <Text style={[irS.value, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}
const irS = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  label: { fontSize: 13, color: TEXT3, fontWeight: '500' },
  value: { fontSize: 13, fontWeight: '700', color: TEXT },
});

function SigChip({ label, signed }: { label: string; signed: boolean }) {
  return (
    <View style={[scS.outer, signed ? scS.outerSigned : scS.outerUnsigned]}>
      <View style={[scS.inner, signed ? scS.innerSigned : scS.innerUnsigned]}>
        <Ionicons
          name={signed ? 'checkmark-circle' : 'close-circle-outline'}
          size={22} color={signed ? Colors.success : Colors.danger}
          style={{ marginBottom: 4 }}
        />
        <Text style={[scS.label, signed ? scS.labelSigned : scS.labelUnsigned]}>{label}</Text>
        <Text style={[scS.sub,   signed ? scS.subSigned   : scS.subUnsigned]}>{signed ? 'Signé' : 'Non signé'}</Text>
      </View>
    </View>
  );
}
const scS = StyleSheet.create({
  outer:         { flex: 1, borderRadius: 12 },
  outerSigned:   { shadowColor: '#107a30', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4 },
  outerUnsigned: { shadowColor: NEO_SHD,  shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1,    shadowRadius: 5, elevation: 4 },
  inner:         { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1,
    shadowColor: '#ffffff', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 1, shadowRadius: 4 },
  innerSigned:   { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  innerUnsigned: { backgroundColor: NEO,              borderColor: '#b8ccd8' },
  label:         { fontSize: 13, fontWeight: '700' },
  labelSigned:   { color: Colors.success },
  labelUnsigned: { color: Colors.danger },
  sub:           { fontSize: 10, marginTop: 2 },
  subSigned:     { color: Colors.success },
  subUnsigned:   { color: Colors.danger },
});

function modePaiementLabel(mode: string): string {
  const MAP: Record<string, string> = {
    ESPECES: 'Espèces', MOBILE_MONEY: 'Mobile Money', CHEQUE: 'Chèque',
    VIREMENT: 'Virement', CREDIT: 'Crédit',
  };
  return MAP[mode] ?? mode;
}

/* Styles */
const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: NEO },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO, padding: 32 },

  /* État vide : raised */
  emptyOuter: {
    borderRadius: 16, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 8,
  },
  emptyInner: {
    borderRadius: 16, backgroundColor: NEO, padding: 28, alignItems: 'center',
    shadowColor: '#ffffff', shadowOffset: { width: -5, height: -5 }, shadowOpacity: 1, shadowRadius: 7,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: TEXT2, marginBottom: 6 },
  emptyText:  { fontSize: 13, color: TEXT3, textAlign: 'center', lineHeight: 20 },

  /* Header navy */
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 180, height: 180, borderRadius: 90, top: -50, right: -40, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', width: 90,  height: 90,  borderRadius: 45, top: 50,  right: 110, backgroundColor: 'rgba(7,155,217,0.07)' },
  headerContent: { padding: 16, paddingBottom: 20 },
  headerTopRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },

  typeChip:  { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  typeChipC: { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  typeChipR: { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: 12, fontWeight: '700', color: '#e2e8f0' },
  sousType: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 },
  dateText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },

  syncPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  syncPillSynced:  { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  syncPillPending: { backgroundColor: Colors.warningBg, borderColor: Colors.warningBorder },
  syncDot:         { width: 7, height: 7, borderRadius: 4 },
  syncPillText:    { fontSize: 12, fontWeight: '700' },

  /* Cartes raised */
  cardOuter: {
    marginHorizontal: 12, marginBottom: 4,
    borderRadius: 14, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  cardInner: {
    borderRadius: 14, backgroundColor: NEO, padding: 14,
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 }, shadowOpacity: 1, shadowRadius: 7,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  fieldSep: { height: 1, backgroundColor: SEP, marginVertical: 8 },

  /* Lignes produits */
  ligneRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  ligneRowSep:  { borderTopWidth: 1, borderTopColor: SEP },
  codeBadge:    { backgroundColor: Colors.infoBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeBadgeText:{ fontSize: 12, fontWeight: '700', color: Colors.brandBlue },
  ligneQte:     { flex: 1, fontSize: 14, color: TEXT2, fontWeight: '600' },
  ligneMontant: { fontSize: 14, fontWeight: '700', color: TEXT },
  emptyRowText: { color: TEXT3, fontSize: 13 },

  /* Montant héro */
  montantHeroRow:  { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 8 },
  montantHeroValue:{ fontSize: 34, fontWeight: '800', color: TEXT, letterSpacing: -1 },
  montantHeroUnit: { fontSize: 16, fontWeight: '600', color: TEXT2 },

  /* Commentaire inset */
  commentaireBox: {
    backgroundColor: NEO_IN, borderRadius: 10, padding: 12,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#a8bac8', borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
  },
  commentaire: { fontSize: 14, color: TEXT2, lineHeight: 22 },

  /* Sig row */
  sigRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
