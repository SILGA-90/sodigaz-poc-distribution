import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  isConnected: boolean | null;
}

/**
 * Barre rouge en haut de l'ecran quand l'appareil est hors ligne.
 * Invisible quand connecte (null = etat initial pas encore connu).
 */
export default function NetworkBanner({ isConnected }: Props): React.ReactElement | null {
  if (isConnected !== false) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Hors ligne — synchronisation impossible</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#dc3545',
    paddingVertical: 7,
    alignItems: 'center',
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
});
