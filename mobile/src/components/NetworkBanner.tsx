/**
 * Bandeau de connectivité réseau.
 *
 * Ce composant affiche une barre rouge en haut de l'écran quand
 * l'appareil est hors ligne (isConnected === false). Il est invisible
 * quand l'état est null (pas encore déterminé) ou true (connecté).
 *
 * Au démarrage, NetInfo
 * renvoie null avant de connaître l'état du réseau. Afficher le bandeau
 * sur null provoquerait un flash rouge trompeur au démarrage. On attend
 * une confirmation explicite hors ligne (false) avant d'alerter.
 *
 * Plusieurs écrans (DashboardScreen, ProgrammeScreen,
 * SaisieOperationScreen) doivent afficher ce bandeau. Le factoriser
 * évite de dupliquer la logique de rendu conditionnel.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { scale } from '../theme';

interface Props {
  isConnected: boolean | null;
}

export default function NetworkBanner({ isConnected }: Props): React.ReactElement | null {
  if (isConnected !== false) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Hors ligne : synchronisation impossible</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#dc3545',
    paddingVertical: 7,
    alignItems: 'center',
  },
  text: { color: '#fff', fontSize: scale(12), fontWeight: '700', letterSpacing: 0.3 },
});
