#!/bin/bash
# =============================================================================
# Sprint 3.1 du mobile : ecran de saisie d'operation
#   - formulaire de saisie (type, quantites par article, paiement, montant)
#   - RESTITUTION : produits prevus pre-remplis ; COLLECTE : tous les produits
#   - montant calcule auto, corrigeable
#   - enregistrement local PENDING (remplace le bouton de test)
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_1.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : execute depuis ~/sodigaz_poc"
    exit 1
fi

cd mobile

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null 2>&1 || true

echo "=== Installation du picker (menu deroulant) ==="
npx expo install @react-native-picker/picker

echo ""
echo "=== Creation des fichiers ==="

# -----------------------------------------------------------------------------
# Repository : lecture des produits + lignes prevues + creation operation reelle
# -----------------------------------------------------------------------------
cat > src/db/repositories/saisieRepository.ts << 'TSEOF'
/**
 * Repository pour la saisie d'operation.
 * Fournit les donnees necessaires au formulaire et enregistre l'operation.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';
import { Produit, TypeOperation, SousTypeCollecte, ModePaiement } from '../../types/models';

export interface ProduitSaisie extends Produit {
  quantite_prevue: number | null; // non null si produit prevu (restitution)
}

export interface EtapeInfo {
  uuid: string;
  programme_uuid: string;
  type_programme: 'COLLECTE' | 'RESTITUTION';
  plv_libelle: string;
  client_raison_sociale: string;
}

/**
 * Infos de l'etape (avec le type de programme parent et le PLV).
 */
export async function getEtapeInfo(etapeId: number): Promise<EtapeInfo | null> {
  const db = await getDatabase();
  return db.getFirstAsync<EtapeInfo>(
    `SELECT
        e.uuid AS uuid,
        pr.uuid AS programme_uuid,
        pr.type_programme AS type_programme,
        p.libelle AS plv_libelle,
        c.raison_sociale AS client_raison_sociale
     FROM etape e
     JOIN programme pr ON pr.id = e.programme_id
     JOIN plv p ON p.id = e.plv_id
     JOIN client c ON c.id = p.client_id
     WHERE e.id = ?;`,
    [etapeId],
  );
}

/**
 * Produits saisissables pour une etape donnee.
 *   - RESTITUTION : uniquement les produits prevus (lignes_programme),
 *     avec leur quantite prevue.
 *   - COLLECTE : tous les produits actifs, quantite_prevue = null.
 */
export async function getProduitsSaisissables(
  etapeId: number,
  typeProgramme: 'COLLECTE' | 'RESTITUTION',
): Promise<ProduitSaisie[]> {
  const db = await getDatabase();

  if (typeProgramme === 'RESTITUTION') {
    return db.getAllAsync<ProduitSaisie>(
      `SELECT
          pr.*,
          lp.quantite_prevue AS quantite_prevue
       FROM ligne_programme lp
       JOIN produit pr ON pr.id = lp.produit_id
       WHERE lp.etape_id = ? AND lp.is_deleted = 0
       ORDER BY pr.libelle;`,
      [etapeId],
    );
  }

  // COLLECTE : tous les produits actifs
  return db.getAllAsync<ProduitSaisie>(
    `SELECT *, NULL AS quantite_prevue
     FROM produit
     WHERE actif = 1
     ORDER BY libelle;`,
  );
}

export interface LigneSaisie {
  produit_code_x3: string;
  quantite_realisee: number;
  montant_ligne: number;
}

export interface OperationSaisie {
  etape_uuid: string;
  type_operation: TypeOperation;
  sous_type: SousTypeCollecte;
  mode_paiement: ModePaiement;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: boolean;
  commentaire: string;
  lignes: LigneSaisie[];
}

/**
 * Verifie s'il existe deja une operation PENDING pour cette etape (pour edition).
 */
export async function getOperationPendingPourEtape(
  etapeUuid: string,
): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ uuid: string }>(
    `SELECT uuid FROM operation
     WHERE etape_uuid = ? AND sync_status = 'PENDING' AND is_deleted = 0
     LIMIT 1;`,
    [etapeUuid],
  );
  return row?.uuid ?? null;
}

/**
 * Enregistre une operation en local (PENDING).
 * Si une operation PENDING existe deja pour l'etape, on la remplace
 * (mise a jour, pas duplication).
 */
export async function enregistrerOperation(data: OperationSaisie): Promise<string> {
  const db = await getDatabase();
  const ts = Date.now();
  const nowIso = new Date().toISOString();

  // Edition d'une operation PENDING existante ?
  const existant = await getOperationPendingPourEtape(data.etape_uuid);
  const opUuid = existant ?? Crypto.randomUUID();

  await db.withTransactionAsync(async () => {
    if (existant) {
      // Supprimer les anciennes lignes PENDING de cette operation
      await db.runAsync('DELETE FROM ligne_operation WHERE operation_uuid = ?;', [opUuid]);
      await db.runAsync(
        `UPDATE operation SET
           type_operation = ?, sous_type = ?, mode_paiement = ?,
           montant_total = ?, montant_encaisse = ?, est_encaissee = ?,
           commentaire = ?, date_heure = ?, last_modified = ?
         WHERE uuid = ?;`,
        [
          data.type_operation, data.sous_type ?? null, data.mode_paiement ?? null,
          data.montant_total, data.montant_encaisse, data.est_encaissee ? 1 : 0,
          data.commentaire, nowIso, ts, opUuid,
        ],
      );
    } else {
      await db.runAsync(
        `INSERT INTO operation
         (uuid, etape_uuid, type_operation, sous_type, date_heure,
          latitude, longitude, mode_paiement, montant_total, montant_encaisse,
          est_encaissee, signature_livreur, signature_client, nom_signataire_client,
          commentaire, sync_status, last_modified, is_deleted)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, '', '', '', ?, 'PENDING', ?, 0);`,
        [
          opUuid, data.etape_uuid, data.type_operation, data.sous_type ?? null, nowIso,
          data.mode_paiement ?? null, data.montant_total, data.montant_encaisse,
          data.est_encaissee ? 1 : 0, data.commentaire, ts,
        ],
      );
    }

    // (Re)creer les lignes
    for (const ligne of data.lignes) {
      if (ligne.quantite_realisee <= 0) continue; // on ignore les lignes a 0
      await db.runAsync(
        `INSERT INTO ligne_operation
         (uuid, operation_uuid, produit_code_x3, quantite_realisee,
          quantite_collectee_vide, quantite_consignee, quantite_deconsignee,
          montant_ligne, sync_status, last_modified, is_deleted)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'PENDING', ?, 0);`,
        [Crypto.randomUUID(), opUuid, ligne.produit_code_x3,
         ligne.quantite_realisee, ligne.montant_ligne, ts],
      );
    }

    // Marquer l'etape comme visitee
    await db.runAsync(
      `UPDATE etape SET statut_visite = 'VISITEE', last_modified = ?
       WHERE uuid = ?;`,
      [ts, data.etape_uuid],
    );
  });

  return opUuid;
}
TSEOF

echo "  + saisieRepository.ts cree"

# -----------------------------------------------------------------------------
# Ecran de saisie d'operation
# -----------------------------------------------------------------------------
cat > src/screens/SaisieOperationScreen.tsx << 'TSEOF'
/**
 * Ecran de saisie d'une operation (collecte ou restitution) sur une etape.
 *
 * - RESTITUTION : produits prevus pre-remplis avec quantite prevue affichee.
 * - COLLECTE : tous les produits, quantites a 0 par defaut.
 * - Montant calcule auto (somme quantite x prix), corrigeable.
 * - Enregistrement local PENDING (offline-first).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapeInfo,
  getProduitsSaisissables,
  enregistrerOperation,
  ProduitSaisie,
  EtapeInfo,
} from '../db/repositories/saisieRepository';
import { ModePaiement } from '../types/models';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'SaisieOperation'>;

interface LigneState {
  produit: ProduitSaisie;
  quantite: string; // string pour le TextInput
}

const MODES_PAIEMENT: { label: string; value: ModePaiement }[] = [
  { label: 'Especes', value: 'ESPECES' },
  { label: 'Mobile Money', value: 'MOBILE_MONEY' },
  { label: 'Cheque', value: 'CHEQUE' },
  { label: 'Virement', value: 'VIREMENT' },
  { label: 'Credit', value: 'CREDIT' },
];

export default function SaisieOperationScreen({ route, navigation }: Props): React.ReactElement {
  const { etapeId } = route.params;

  const [etapeInfo, setEtapeInfo] = useState<EtapeInfo | null>(null);
  const [lignes, setLignes] = useState<LigneState[]>([]);
  const [modePaiement, setModePaiement] = useState<ModePaiement>('ESPECES');
  const [montantManuel, setMontantManuel] = useState<string>('');
  const [montantCorrige, setMontantCorrige] = useState<boolean>(false);
  const [estEncaissee, setEstEncaissee] = useState<boolean>(true);
  const [commentaire, setCommentaire] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const info = await getEtapeInfo(etapeId);
      if (!info) {
        Alert.alert('Erreur', 'Etape introuvable.');
        navigation.goBack();
        return;
      }
      const produits = await getProduitsSaisissables(etapeId, info.type_programme);
      setEtapeInfo(info);
      setLignes(
        produits.map((p) => ({
          produit: p,
          quantite: p.quantite_prevue != null ? String(p.quantite_prevue) : '0',
        })),
      );
      setLoading(false);
    })();
  }, [etapeId, navigation]);

  // Montant calcule automatiquement
  const montantCalcule = useMemo(() => {
    return lignes.reduce((sum, l) => {
      const q = parseInt(l.quantite, 10) || 0;
      return sum + q * l.produit.prix_unitaire;
    }, 0);
  }, [lignes]);

  const montantFinal = montantCorrige
    ? parseFloat(montantManuel) || 0
    : montantCalcule;

  function updateQuantite(index: number, valeur: string): void {
    const copy = [...lignes];
    copy[index].quantite = valeur.replace(/[^0-9]/g, '');
    setLignes(copy);
  }

  async function handleSave(): Promise<void> {
    if (!etapeInfo) return;

    const lignesSaisies = lignes
      .map((l) => ({
        produit_code_x3: l.produit.code_x3,
        quantite_realisee: parseInt(l.quantite, 10) || 0,
        montant_ligne: (parseInt(l.quantite, 10) || 0) * l.produit.prix_unitaire,
      }))
      .filter((l) => l.quantite_realisee > 0);

    if (lignesSaisies.length === 0) {
      Alert.alert('Aucune quantite', 'Saisis au moins une quantite superieure a 0.');
      return;
    }

    setSaving(true);
    try {
      const typeOp = etapeInfo.type_programme === 'COLLECTE' ? 'COLLECTE' : 'RESTITUTION';
      await enregistrerOperation({
        etape_uuid: etapeInfo.uuid,
        type_operation: typeOp,
        sous_type: typeOp === 'COLLECTE' ? 'BCR' : null,
        mode_paiement: modePaiement,
        montant_total: montantFinal,
        montant_encaisse: estEncaissee ? montantFinal : 0,
        est_encaissee: estEncaissee,
        commentaire,
        lignes: lignesSaisies,
      });
      Alert.alert(
        'Operation enregistree',
        'L\'operation est enregistree localement. Elle sera remontee a la prochaine synchronisation.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {etapeInfo && (
        <View style={styles.header}>
          <Text style={styles.typeOp}>{etapeInfo.type_programme}</Text>
          <Text style={styles.plvName}>{etapeInfo.plv_libelle}</Text>
          <Text style={styles.clientName}>{etapeInfo.client_raison_sociale}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Articles</Text>
      {lignes.map((ligne, index) => (
        <View key={ligne.produit.code_x3} style={styles.ligneCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.produitLibelle}>{ligne.produit.libelle}</Text>
            <Text style={styles.produitPrix}>
              {ligne.produit.prix_unitaire.toLocaleString('fr-FR')} FCFA / unite
            </Text>
            {ligne.produit.quantite_prevue != null && (
              <Text style={styles.prevue}>Prevu : {ligne.produit.quantite_prevue}</Text>
            )}
          </View>
          <TextInput
            style={styles.qteInput}
            value={ligne.quantite}
            onChangeText={(v) => updateQuantite(index, v)}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
      ))}

      <Text style={styles.sectionTitle}>Paiement</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Mode de paiement</Text>
        <View style={styles.pickerWrap}>
          <Picker
            selectedValue={modePaiement}
            onValueChange={(v) => setModePaiement(v as ModePaiement)}
          >
            {MODES_PAIEMENT.map((m) => (
              <Picker.Item key={m.value} label={m.label} value={m.value} />
            ))}
          </Picker>
        </View>

        <View style={styles.montantRow}>
          <Text style={styles.label}>Montant total (FCFA)</Text>
          <TouchableOpacity onPress={() => setMontantCorrige(!montantCorrige)}>
            <Text style={styles.toggleLink}>
              {montantCorrige ? 'Revenir au calcul auto' : 'Corriger manuellement'}
            </Text>
          </TouchableOpacity>
        </View>

        {montantCorrige ? (
          <TextInput
            style={styles.montantInput}
            value={montantManuel}
            onChangeText={(v) => setMontantManuel(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder={String(montantCalcule)}
          />
        ) : (
          <Text style={styles.montantAuto}>
            {montantCalcule.toLocaleString('fr-FR')} FCFA
            <Text style={styles.montantAutoHint}> (calcule)</Text>
          </Text>
        )}

        <View style={styles.switchRow}>
          <Text style={styles.label}>Montant encaisse ?</Text>
          <Switch value={estEncaissee} onValueChange={setEstEncaissee} />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Commentaire (optionnel)</Text>
      <TextInput
        style={styles.commentaire}
        value={commentaire}
        onChangeText={setCommentaire}
        multiline
        placeholder="Remarque eventuelle..."
      />

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>Enregistrer l'operation</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#0d6efd', padding: 16 },
  typeOp: { color: '#cbe2ff', fontSize: 12, fontWeight: '700' },
  plvName: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  clientName: { color: '#cbe2ff', fontSize: 14 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: '#333',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  ligneCard: {
    backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8,
    padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center',
  },
  produitLibelle: { fontSize: 15, fontWeight: '600', color: '#333' },
  produitPrix: { fontSize: 12, color: '#888', marginTop: 2 },
  prevue: { fontSize: 12, color: '#0d6efd', marginTop: 2, fontWeight: '600' },
  qteInput: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    padding: 10, width: 64, textAlign: 'center', fontSize: 18,
    backgroundColor: '#fff',
  },
  card: { backgroundColor: '#fff', marginHorizontal: 12, padding: 14, borderRadius: 10 },
  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  pickerWrap: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, marginTop: 6, marginBottom: 12 },
  montantRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleLink: { color: '#0d6efd', fontSize: 13 },
  montantInput: {
    borderWidth: 1, borderColor: '#0d6efd', borderRadius: 8,
    padding: 12, fontSize: 18, marginTop: 6, backgroundColor: '#fff',
  },
  montantAuto: { fontSize: 22, fontWeight: '700', color: '#198754', marginTop: 6 },
  montantAutoHint: { fontSize: 13, fontWeight: '400', color: '#888' },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 14,
  },
  commentaire: {
    backgroundColor: '#fff', marginHorizontal: 12, padding: 12,
    borderRadius: 10, minHeight: 70, textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: '#198754', margin: 16, padding: 16,
    borderRadius: 10, alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
TSEOF

echo "  + SaisieOperationScreen.tsx cree"

# -----------------------------------------------------------------------------
# Rendre les etapes cliquables dans ProgrammeScreen -> SaisieOperation
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

# 1. navigation type
nav = Path("src/types/navigation.ts")
content = nav.read_text()
if "SaisieOperation" not in content:
    content = content.replace(
        "  Programme: { programmeId: number };",
        "  Programme: { programmeId: number };\n  SaisieOperation: { etapeId: number };",
    )
    nav.write_text(content)
    print("  + type SaisieOperation ajoute")

# 2. RootNavigator
root = Path("src/navigation/RootNavigator.tsx")
content = root.read_text()
if "SaisieOperationScreen" not in content:
    content = content.replace(
        "import ProgrammeScreen from '../screens/ProgrammeScreen';",
        "import ProgrammeScreen from '../screens/ProgrammeScreen';\n"
        "import SaisieOperationScreen from '../screens/SaisieOperationScreen';",
    )
    content = content.replace(
        '<Stack.Screen name="Programme" component={ProgrammeScreen} options={{ headerShown: true, title: "Programme" }} />',
        '<Stack.Screen name="Programme" component={ProgrammeScreen} options={{ headerShown: true, title: "Programme" }} />\n'
        '        <Stack.Screen name="SaisieOperation" component={SaisieOperationScreen} options={{ headerShown: true, title: "Saisie operation" }} />',
    )
    root.write_text(content)
    print("  + SaisieOperationScreen enregistre")

# 3. ProgrammeScreen : rendre chaque etape cliquable
prog = Path("src/screens/ProgrammeScreen.tsx")
content = prog.read_text()

# Ajouter useNavigation et le type, et envelopper la carte dans un TouchableOpacity
if "navigation.navigate('SaisieOperation'" not in content:
    # Importer TouchableOpacity (deja importe ? sinon on l'ajoute)
    if "TouchableOpacity" not in content:
        content = content.replace(
            "  StyleSheet,\n  Text,\n  View,",
            "  StyleSheet,\n  Text,\n  TouchableOpacity,\n  View,",
        )
    # Recuperer navigation depuis les props
    content = content.replace(
        "export default function ProgrammeScreen({ route }: Props): React.ReactElement {",
        "export default function ProgrammeScreen({ route, navigation }: Props): React.ReactElement {",
    )
    # Remplacer le <View style={styles.card}> de renderEtape par un TouchableOpacity navigable
    content = content.replace(
        "    return (\n      <View style={styles.card}>",
        "    return (\n      <TouchableOpacity\n        style={styles.card}\n        onPress={() => navigation.navigate('SaisieOperation', { etapeId: item.id })}\n      >",
    )
    content = content.replace(
        "        <View style={[styles.statutBadge, visite ? styles.visitee : styles.aVisiter]}>\n          <Text style={styles.statutText}>{visite ? 'Visitee' : 'A visiter'}</Text>\n        </View>\n      </View>\n    );",
        "        <View style={[styles.statutBadge, visite ? styles.visitee : styles.aVisiter]}>\n          <Text style={styles.statutText}>{visite ? 'Visitee' : 'A visiter'}</Text>\n        </View>\n      </TouchableOpacity>\n    );",
    )
    prog.write_text(content)
    print("  + etapes rendues cliquables vers SaisieOperation")
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.1 - SAISIE D'OPERATION TERMINEE."
echo "=============================================="
echo ""
echo "Test :"
echo "  1. Recharge l'app, connecte-toi, synchronise."
echo "  2. Ouvre un programme, tape sur une etape (un PLV)."
echo "  3. Le formulaire de saisie s'ouvre :"
echo "     - RESTITUTION : les articles prevus sont pre-remplis"
echo "     - COLLECTE : tu choisis les quantites parmi tous les produits"
echo "  4. Ajuste les quantites, le montant se calcule automatiquement."
echo "  5. Choisis le mode de paiement, enregistre."
echo "  6. L'etape passe a 'Visitee'."
echo "  7. Reviens au Dashboard, synchronise."
echo "  8. Verifie sur la supervision web que l'operation est remontee"
echo "     avec les bonnes quantites et le bon montant."
echo ""
echo "Le bouton de test du Sprint 2.3 reste dispo dans Debug, mais"
echo "tu as maintenant un vrai formulaire de saisie."
echo ""
