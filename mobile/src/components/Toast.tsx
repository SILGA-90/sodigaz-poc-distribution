/**
 * Composant Toast : notification flottante éphémère.
 *
 * Ce composant affiche un message flottant en bas de l'écran avec une
 * animation d'apparition (fade-in + slide-up) et disparaît automatiquement
 * après `duration` millisecondes. Trois types : success (vert), error (rouge),
 * info (bleu Sodigaz).
 *
 * Les bibliothèques de toast
 * React Native (ex. react-native-toast-message) nécessitent souvent un
 * build natif ou un Provider global. Une implémentation légère avec
 * Animated.View est suffisante, compatible Expo Go, et ne dépend pas d'un
 * Provider externe.
 *
 * Les boutons d'action sont souvent en bas d'écran. Un toast
 * positionné à 80 px du bas laisse les boutons accessibles sans être
 * masqués par la notification.
 *
 * Les animations opacity et translateY sont
 * exécutées sur le thread natif pour ne pas bloquer le thread JS.
 * Obligatoire pour une animation fluide (60 fps) sur Android milieu de gamme.
 *
 * Si `visible` passe à false avant la fin
 * du timer (ex. l'utilisateur navigue), le timer est annulé pour éviter
 * d'appeler onHide() après le démontage du composant.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Colors } from '../theme';

interface Props {
  visible: boolean;
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  onHide: () => void;
}

const BG: Record<string, string> = {
  success: '#198754',
  error: '#dc3545',
  info: Colors.brandBlue,
};

export default function Toast({
  visible,
  message,
  type = 'success',
  duration = 2800,
  onHide,
}: Props): React.ReactElement | null {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 200, useNativeDriver: true }),
      ]).start(() => onHide());
    }, duration);

    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: BG[type], opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 24,
    right: 24,
    padding: 14,
    borderRadius: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 999,
  },
  text: { color: '#fff', fontWeight: '600', fontSize: 14, textAlign: 'center' },
});
