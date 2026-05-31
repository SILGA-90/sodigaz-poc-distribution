#!/bin/bash
# =============================================================================
# Sprint 3.2 du mobile : capture des signatures (livreur + client)
#   - composant de signature tactile (react-native-signature-canvas)
#   - integration dans le formulaire de saisie d'operation
#   - stockage des signatures (base64) dans l'operation locale
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_2.sh
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

echo "=== Installation des dependances de signature ==="
# react-native-webview est requis par signature-canvas
npx expo install react-native-webview
npm install react-native-signature-canvas

echo ""
echo "=== Creation du composant de signature ==="

# -----------------------------------------------------------------------------
# Composant modal de capture de signature
# -----------------------------------------------------------------------------
cat > src/components/SignaturePad.tsx << 'TSEOF'
/**
 * Modal de capture de signature tactile.
 *
 * Utilise react-native-signature-canvas (base sur une webview).
 * Retourne la signature en data-URL base64 (image/png) via onSave.
 *
 * Note technique : le composant fonctionne dans une webview, ce qui peut
 * presenter des differences de comportement selon la plateforme. Sur Expo Go
 * Android, le rendu est correct. La signature est encodee en base64 ;
 * pour un volume de production important, on pourrait basculer vers un
 * format vectoriel plus leger.
 */
import React, { useRef } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';

interface Props {
  visible: boolean;
  titre: string;
  onSave: (signatureBase64: string) => void;
  onCancel: () => void;
}

export default function SignaturePad({ visible, titre, onSave, onCancel }: Props): React.ReactElement {
  const ref = useRef<SignatureViewRef>(null);

  function handleOK(signature: string): void {
    onSave(signature);
  }

  function handleEmpty(): void {
    // L'utilisateur a valide sans rien tracer
    onCancel();
  }

  // Style du canvas (cache les boutons par defaut de la lib, on met les notres)
  const webStyle = `
    .m-signature-pad { box-shadow: none; border: none; }
    .m-signature-pad--body { border: 1px solid #ccc; border-radius: 8px; }
    .m-signature-pad--footer { display: none; }
    body, html { width: 100%; height: 100%; margin: 0; }
  `;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        <Text style={styles.titre}>{titre}</Text>
        <Text style={styles.hint}>Signez dans le cadre ci-dessous</Text>

        <View style={styles.canvasWrap}>
          <SignatureScreen
            ref={ref}
            onOK={handleOK}
            onEmpty={handleEmpty}
            webStyle={webStyle}
            autoClear={false}
            descriptionText=""
          />
        </View>

        <View style={styles.buttonsRow}>
          <TouchableOpacity
            style={[styles.button, styles.buttonClear]}
            onPress={() => ref.current?.clearSignature()}
          >
            <Text style={styles.buttonText}>Effacer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonCancel]}
            onPress={onCancel}
          >
            <Text style={styles.buttonText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonSave]}
            onPress={() => ref.current?.readSignature()}
          >
            <Text style={styles.buttonText}>Valider</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16, paddingTop: 48 },
  titre: { fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center' },
  hint: { fontSize: 13, color: '#888', textAlign: 'center', marginVertical: 8 },
  canvasWrap: { flex: 1, marginVertical: 12 },
  buttonsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  button: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonClear: { backgroundColor: '#6c757d' },
  buttonCancel: { backgroundColor: '#dc3545' },
  buttonSave: { backgroundColor: '#198754' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
TSEOF

echo "  + SignaturePad.tsx cree"

# -----------------------------------------------------------------------------
# Integration dans le SaisieOperationScreen
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

saisie = Path("src/screens/SaisieOperationScreen.tsx")
content = saisie.read_text()

# 1. Importer le composant SignaturePad
content = content.replace(
    "import { Picker } from '@react-native-picker/picker';",
    "import { Picker } from '@react-native-picker/picker';\n"
    "import SignaturePad from '../components/SignaturePad';",
)

# 2. Ajouter les states de signature apres le state commentaire
content = content.replace(
    "  const [commentaire, setCommentaire] = useState<string>('');",
    "  const [commentaire, setCommentaire] = useState<string>('');\n"
    "  const [signatureLivreur, setSignatureLivreur] = useState<string>('');\n"
    "  const [signatureClient, setSignatureClient] = useState<string>('');\n"
    "  const [nomSignataire, setNomSignataire] = useState<string>('');\n"
    "  const [padVisible, setPadVisible] = useState<null | 'LIVREUR' | 'CLIENT'>(null);",
)

# 3. Passer les signatures a enregistrerOperation
#    On modifie l'appel pour inclure les signatures + nom signataire.
#    enregistrerOperation prend un objet ; on doit etendre le repository.
#    Pour rester simple, on ajoute les champs dans l'objet passe.
content = content.replace(
    "      await enregistrerOperation({\n"
    "        etape_uuid: etapeInfo.uuid,\n"
    "        type_operation: typeOp,\n"
    "        sous_type: typeOp === 'COLLECTE' ? 'BCR' : null,\n"
    "        mode_paiement: modePaiement,\n"
    "        montant_total: montantFinal,\n"
    "        montant_encaisse: estEncaissee ? montantFinal : 0,\n"
    "        est_encaissee: estEncaissee,\n"
    "        commentaire,\n"
    "        lignes: lignesSaisies,\n"
    "      });",
    "      await enregistrerOperation({\n"
    "        etape_uuid: etapeInfo.uuid,\n"
    "        type_operation: typeOp,\n"
    "        sous_type: typeOp === 'COLLECTE' ? 'BCR' : null,\n"
    "        mode_paiement: modePaiement,\n"
    "        montant_total: montantFinal,\n"
    "        montant_encaisse: estEncaissee ? montantFinal : 0,\n"
    "        est_encaissee: estEncaissee,\n"
    "        commentaire,\n"
    "        signature_livreur: signatureLivreur,\n"
    "        signature_client: signatureClient,\n"
    "        nom_signataire_client: nomSignataire,\n"
    "        lignes: lignesSaisies,\n"
    "      });",
)

# 4. Ajouter la section signatures dans le rendu, juste avant le commentaire
content = content.replace(
    '      <Text style={styles.sectionTitle}>Commentaire (optionnel)</Text>',
    '      <Text style={styles.sectionTitle}>Signatures</Text>\n'
    '      <View style={styles.card}>\n'
    '        <Text style={styles.label}>Nom du signataire (client)</Text>\n'
    '        <TextInput\n'
    '          style={styles.nomInput}\n'
    '          value={nomSignataire}\n'
    '          onChangeText={setNomSignataire}\n'
    '          placeholder="Nom du client signataire"\n'
    '        />\n'
    '        <View style={styles.sigRow}>\n'
    '          <TouchableOpacity\n'
    '            style={[styles.sigButton, signatureLivreur ? styles.sigDone : null]}\n'
    "            onPress={() => setPadVisible('LIVREUR')}\n"
    '          >\n'
    '            <Text style={styles.sigButtonText}>\n'
    "              {signatureLivreur ? 'Signature livreur OK' : 'Signer (livreur)'}\n"
    '            </Text>\n'
    '          </TouchableOpacity>\n'
    '          <TouchableOpacity\n'
    '            style={[styles.sigButton, signatureClient ? styles.sigDone : null]}\n'
    "            onPress={() => setPadVisible('CLIENT')}\n"
    '          >\n'
    '            <Text style={styles.sigButtonText}>\n'
    "              {signatureClient ? 'Signature client OK' : 'Signer (client)'}\n"
    '            </Text>\n'
    '          </TouchableOpacity>\n'
    '        </View>\n'
    '      </View>\n\n'
    '      <Text style={styles.sectionTitle}>Commentaire (optionnel)</Text>',
)

# 5. Ajouter le composant modal SignaturePad a la fin du ScrollView (avant la fermeture)
content = content.replace(
    "      <TouchableOpacity\n"
    "        style={[styles.saveButton, saving && styles.saveDisabled]}\n"
    "        onPress={handleSave}\n"
    "        disabled={saving}\n"
    "      >\n"
    "        {saving ? (\n"
    "          <ActivityIndicator color=\"#fff\" />\n"
    "        ) : (\n"
    "          <Text style={styles.saveText}>Enregistrer l'operation</Text>\n"
    "        )}\n"
    "      </TouchableOpacity>\n"
    "    </ScrollView>",
    "      <TouchableOpacity\n"
    "        style={[styles.saveButton, saving && styles.saveDisabled]}\n"
    "        onPress={handleSave}\n"
    "        disabled={saving}\n"
    "      >\n"
    "        {saving ? (\n"
    "          <ActivityIndicator color=\"#fff\" />\n"
    "        ) : (\n"
    "          <Text style={styles.saveText}>Enregistrer l'operation</Text>\n"
    "        )}\n"
    "      </TouchableOpacity>\n\n"
    "      <SignaturePad\n"
    "        visible={padVisible !== null}\n"
    "        titre={padVisible === 'LIVREUR' ? 'Signature du livreur' : 'Signature du client'}\n"
    "        onSave={(sig) => {\n"
    "          if (padVisible === 'LIVREUR') setSignatureLivreur(sig);\n"
    "          else setSignatureClient(sig);\n"
    "          setPadVisible(null);\n"
    "        }}\n"
    "        onCancel={() => setPadVisible(null)}\n"
    "      />\n"
    "    </ScrollView>",
)

# 6. Ajouter les styles signature
content = content.replace(
    "  saveDisabled: { opacity: 0.6 },",
    "  saveDisabled: { opacity: 0.6 },\n"
    "  nomInput: {\n"
    "    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,\n"
    "    padding: 10, marginTop: 6, marginBottom: 12, backgroundColor: '#fff',\n"
    "  },\n"
    "  sigRow: { flexDirection: 'row', gap: 8 },\n"
    "  sigButton: {\n"
    "    flex: 1, padding: 12, borderRadius: 8, alignItems: 'center',\n"
    "    backgroundColor: '#6c757d',\n"
    "  },\n"
    "  sigDone: { backgroundColor: '#198754' },\n"
    "  sigButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },",
)

saisie.write_text(content)
print("  + signatures integrees au formulaire de saisie")
PYEOF

# -----------------------------------------------------------------------------
# Mise a jour du saisieRepository pour accepter les signatures
# -----------------------------------------------------------------------------
python3 << 'PYEOF'
from pathlib import Path

repo = Path("src/db/repositories/saisieRepository.ts")
content = repo.read_text()

# Ajouter les champs signature a l'interface OperationSaisie
content = content.replace(
    "  est_encaissee: boolean;\n"
    "  commentaire: string;\n"
    "  lignes: LigneSaisie[];",
    "  est_encaissee: boolean;\n"
    "  commentaire: string;\n"
    "  signature_livreur?: string;\n"
    "  signature_client?: string;\n"
    "  nom_signataire_client?: string;\n"
    "  lignes: LigneSaisie[];",
)

# Mettre a jour l'INSERT pour inclure les signatures
content = content.replace(
    "         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, '', '', '', ?, 'PENDING', ?, 0);`,\n"
    "        [\n"
    "          opUuid, data.etape_uuid, data.type_operation, data.sous_type ?? null, nowIso,\n"
    "          data.mode_paiement ?? null, data.montant_total, data.montant_encaisse,\n"
    "          data.est_encaissee ? 1 : 0, data.commentaire, ts,\n"
    "        ],",
    "         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0);`,\n"
    "        [\n"
    "          opUuid, data.etape_uuid, data.type_operation, data.sous_type ?? null, nowIso,\n"
    "          data.mode_paiement ?? null, data.montant_total, data.montant_encaisse,\n"
    "          data.est_encaissee ? 1 : 0,\n"
    "          data.signature_livreur ?? '', data.signature_client ?? '',\n"
    "          data.nom_signataire_client ?? '', data.commentaire, ts,\n"
    "        ],",
)

# Mettre a jour l'UPDATE pour inclure les signatures
content = content.replace(
    "        `UPDATE operation SET\n"
    "           type_operation = ?, sous_type = ?, mode_paiement = ?,\n"
    "           montant_total = ?, montant_encaisse = ?, est_encaissee = ?,\n"
    "           commentaire = ?, date_heure = ?, last_modified = ?\n"
    "         WHERE uuid = ?;`,\n"
    "        [\n"
    "          data.type_operation, data.sous_type ?? null, data.mode_paiement ?? null,\n"
    "          data.montant_total, data.montant_encaisse, data.est_encaissee ? 1 : 0,\n"
    "          data.commentaire, nowIso, ts, opUuid,\n"
    "        ],",
    "        `UPDATE operation SET\n"
    "           type_operation = ?, sous_type = ?, mode_paiement = ?,\n"
    "           montant_total = ?, montant_encaisse = ?, est_encaissee = ?,\n"
    "           signature_livreur = ?, signature_client = ?, nom_signataire_client = ?,\n"
    "           commentaire = ?, date_heure = ?, last_modified = ?\n"
    "         WHERE uuid = ?;`,\n"
    "        [\n"
    "          data.type_operation, data.sous_type ?? null, data.mode_paiement ?? null,\n"
    "          data.montant_total, data.montant_encaisse, data.est_encaissee ? 1 : 0,\n"
    "          data.signature_livreur ?? '', data.signature_client ?? '',\n"
    "          data.nom_signataire_client ?? '',\n"
    "          data.commentaire, nowIso, ts, opUuid,\n"
    "        ],",
)

repo.write_text(content)
print("  + saisieRepository gere les signatures")
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.2 - SIGNATURES TERMINEES."
echo "=============================================="
echo ""
echo "Test :"
echo "  1. Recharge l'app (npx expo start, puis reload sur le telephone)."
echo "  2. Ouvre une etape, remplis les quantites."
echo "  3. Dans la section Signatures :"
echo "     - saisis le nom du signataire client"
echo "     - tape 'Signer (livreur)', trace au doigt, Valider"
echo "     - tape 'Signer (client)', trace au doigt, Valider"
echo "     Les boutons passent au vert quand la signature est capturee."
echo "  4. Enregistre l'operation, synchronise."
echo "  5. Cote serveur (admin Django > Operations), tu verras les champs"
echo "     signature_livreur / signature_client remplis (longue chaine base64)."
echo ""
echo "ATTENTION : signature-canvas utilise une webview. Si l'ecran de"
echo "signature reste blanc ou plante sur Expo Go, dis-le-moi : on a un"
echo "plan B (capture par trace SVG natif sans webview)."
echo ""
