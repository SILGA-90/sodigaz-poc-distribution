#!/bin/bash
# =============================================================================
# Sprint 3.2 (plan B) : capture de signature NATIVE en SVG
#   - remplace react-native-signature-canvas (webview, tracé décalé)
#   - capture tactile via PanResponder + rendu react-native-svg
#   - signature stockee en chaine SVG (legere, vectorielle)
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_2bis.sh
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

echo "=== Installation de react-native-svg ==="
npx expo install react-native-svg

echo ""
echo "=== Desinstallation des dependances webview (devenues inutiles) ==="
npm uninstall react-native-signature-canvas || true

echo ""
echo "=== Remplacement du composant SignaturePad par la version native SVG ==="

cat > src/components/SignaturePad.tsx << 'TSEOF'
/**
 * Modal de capture de signature NATIVE (sans webview).
 *
 * Implementation maison :
 *   - capture tactile via PanResponder (API native React Native)
 *   - accumulation des points en chemins (paths) SVG
 *   - rendu en temps reel avec react-native-svg
 *   - sortie : une chaine SVG complete (vectorielle, legere)
 *
 * Avantages vs webview : pas de decalage tactile, tres leger (quelques Ko),
 * net a toute echelle, aucune dependance externe lourde.
 */
import React, { useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface Props {
  visible: boolean;
  titre: string;
  onSave: (signatureSvg: string) => void;
  onCancel: () => void;
}

// Dimensions du canvas de signature
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 200;

export default function SignaturePad({ visible, titre, onSave, onCancel }: Props): React.ReactElement {
  // Liste des traces terminees (chaque trace = une chaine "M x y L x y L ...")
  const [paths, setPaths] = useState<string[]>([]);
  // Trace en cours de dessin
  const [currentPath, setCurrentPath] = useState<string>('');

  // On garde le path courant dans une ref pour le PanResponder (closure stable)
  const currentPathRef = useRef<string>('');

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        const newPath = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
        currentPathRef.current = newPath;
        setCurrentPath(newPath);
      },

      onPanResponderMove: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        const updated = `${currentPathRef.current} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
        currentPathRef.current = updated;
        setCurrentPath(updated);
      },

      onPanResponderRelease: () => {
        const finished = currentPathRef.current;
        if (finished) {
          setPaths((prev) => [...prev, finished]);
        }
        currentPathRef.current = '';
        setCurrentPath('');
      },
    }),
  ).current;

  function handleClear(): void {
    setPaths([]);
    setCurrentPath('');
    currentPathRef.current = '';
  }

  function handleValidate(): void {
    if (paths.length === 0 && !currentPath) {
      onCancel();
      return;
    }
    // Construire le SVG complet
    const allPaths = [...paths];
    if (currentPath) allPaths.push(currentPath);

    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">${allPaths
      .map(
        (d) =>
          `<path d="${d}" stroke="#000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('')}</svg>`;

    onSave(svgContent);
    handleClear();
  }

  function handleCancel(): void {
    handleClear();
    onCancel();
  }

  const allPathsToRender = currentPath ? [...paths, currentPath] : paths;

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        <Text style={styles.titre}>{titre}</Text>
        <Text style={styles.hint}>Signez dans le cadre ci-dessous</Text>

        <View style={styles.canvasContainer}>
          <View style={styles.canvas} {...panResponder.panHandlers}>
            <Svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
              {allPathsToRender.map((d, i) => (
                <Path
                  key={i}
                  d={d}
                  stroke="#000"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
          </View>
        </View>

        <View style={styles.buttonsRow}>
          <TouchableOpacity style={[styles.button, styles.buttonClear]} onPress={handleClear}>
            <Text style={styles.buttonText}>Effacer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.buttonCancel]} onPress={handleCancel}>
            <Text style={styles.buttonText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.buttonSave]} onPress={handleValidate}>
            <Text style={styles.buttonText}>Valider</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16, paddingTop: 48, alignItems: 'center' },
  titre: { fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center' },
  hint: { fontSize: 13, color: '#888', textAlign: 'center', marginVertical: 8 },
  canvasContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  canvas: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    backgroundColor: '#fafafa',
  },
  buttonsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, width: '100%' },
  button: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonClear: { backgroundColor: '#6c757d' },
  buttonCancel: { backgroundColor: '#dc3545' },
  buttonSave: { backgroundColor: '#198754' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
TSEOF

echo "  + SignaturePad.tsx remplace par la version native SVG"

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.2 (PLAN B) - SIGNATURE NATIVE SVG."
echo "=============================================="
echo ""
echo "Aucun changement dans le formulaire de saisie : il utilise deja"
echo "le composant SignaturePad, on a juste change son implementation."
echo ""
echo "Test :"
echo "  1. Recharge l'app (npx expo start --clear puis reload)."
echo "     Le --clear vide le cache Metro, important apres un changement de lib."
echo "  2. Ouvre une etape, va dans Signatures, tape 'Signer (livreur)'."
echo "  3. Trace au doigt : le trait doit suivre PRECISEMENT ton doigt"
echo "     cette fois (capture native, pas de webview)."
echo "  4. Valide. Le bouton passe au vert."
echo "  5. Enregistre, synchronise, verifie cote admin Django."
echo "     Le champ signature contient maintenant du SVG (commence par <svg)."
echo ""
echo "Note : on a desinstalle react-native-signature-canvas et"
echo "react-native-webview n'est plus utilise par la signature."
echo ""
