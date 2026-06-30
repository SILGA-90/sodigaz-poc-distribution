/**
 * SignaturePad : capture de signature tactile native.
 *
 * Ce composant modal permet au livreur et au client de signer
 * numériquement. Il capture les tracés tactiles via PanResponder,
 * les accumule en chemins SVG, et retourne la signature sous forme
 * de chaîne SVG complète via le callback onSave().
 *
 * Les bibliothèques de signature
 * basées sur WebView (ex. react-native-signature-canvas) injectent un
 * canvas HTML dans une WebView, ce qui introduit un décalage tactile
 * perceptible (communication JS -> WebView -> JS), un rendu flou sur
 * écrans haute densité, et une dépendance lourde incompatible avec
 * certaines versions d'Expo Go. PanResponder est une API React Native
 * native : zéro décalage, rendu natif via react-native-svg.
 *
 * Le SVG est vectoriel (net à toute
 * taille, imprimable), léger (quelques centaines d'octets vs dizaines
 * de Ko pour un PNG), et stockable directement en TEXT dans SQLite
 * sans encodage intermédiaire. Le serveur Django stocke le SVG tel quel
 * dans le champ `signature_livreur` / `signature_client`.
 *
 * PanResponder crée une closure
 * au montage du composant. Sans la ref, onPanResponderMove lit toujours
 * la valeur initiale de currentPath (closure stale). La ref est mise à
 * jour de façon synchrone et sert de source de vérité dans la closure.
 * useState est maintenu uniquement pour forcer le re-render du SVG.
 *
 * Bibliothèque standard de rendu SVG sur React Native,
 * compatible Expo Go sans build natif supplémentaire.
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
  useWindowDimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors, scale } from '../theme';

interface Props {
  visible: boolean;
  titre: string;
  onSave: (signatureSvg: string) => void;
  onCancel: () => void;
}

export default function SignaturePad({ visible, titre, onSave, onCancel }: Props): React.ReactElement {
  const { width: screenWidth } = useWindowDimensions();
  const CANVAS_WIDTH  = Math.min(screenWidth - 64, 560);
  const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH * 0.5);
  // Liste des tracés terminés (chaque tracé = une chaîne "M x y L x y L ...")
  const [paths, setPaths] = useState<string[]>([]);
  // Tracé en cours de dessin
  const [currentPath, setCurrentPath] = useState<string>('');

  // Ref pour la closure stable de PanResponder (valeur toujours fraîche)
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
          <View style={[styles.canvas, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }]} {...panResponder.panHandlers}>
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
  container: { flex: 1, backgroundColor: '#FFFFFF', padding: 16, paddingTop: 48, alignItems: 'center' },
  titre: { fontSize: scale(18), fontWeight: '700', color: '#1a2a3a', textAlign: 'center' },
  hint: { fontSize: scale(13), color: '#5B6770', textAlign: 'center', marginVertical: 8 },
  canvasContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  canvas: {
    borderWidth: 1,
    borderColor: '#DDE2E6',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  buttonsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, width: '100%' },
  button: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonClear:  { backgroundColor: '#5B6770' },
  buttonCancel: { backgroundColor: Colors.danger },
  buttonSave:   { backgroundColor: Colors.success },
  buttonText: { color: '#fff', fontWeight: '600' },
});
