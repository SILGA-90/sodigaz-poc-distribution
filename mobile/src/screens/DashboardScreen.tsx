/**
 * Ecran d'accueil apres connexion.
 * Sprint 1 : affiche les infos du livreur connecte (via /api/auth/me/).
 * Sprint 2 : affichera le programme du jour, l'etat de la sync, etc.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { fetchMe, logout } from '../api/authService';
import { UtilisateurInfo } from '../types/auth';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

export default function DashboardScreen({ navigation }: Props): React.ReactElement {
  const [user, setUser] = useState<UtilisateurInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch((error) => {
        Alert.alert('Session expiree', 'Reconnecte-toi.');
        navigation.replace('Login');
      })
      .finally(() => setLoading(false));
  }, [navigation]);

  async function handleLogout(): Promise<void> {
    await logout();
    navigation.replace('Login');
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <Text>Utilisateur introuvable.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcomeSmall}>Bonjour,</Text>
        <Text style={styles.welcomeBig}>{user.first_name} {user.last_name}</Text>
        <Text style={styles.subtitle}>
          Code livreur : <Text style={styles.bold}>{user.code_livreur}</Text>
        </Text>
        <Text style={styles.subtitle}>
          Role : <Text style={styles.bold}>{user.role}</Text>
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Programme du jour</Text>
        <Text style={styles.cardText}>
          (Sera implemente au Sprint 2 : charger depuis /api/sync/pull et afficher
          les etapes a visiter.)
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Synchronisation</Text>
        <Text style={styles.cardText}>
          (Sera implemente au Sprint 2 : etat de la derniere sync, bouton manuel.)
        </Text>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Se deconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#0d6efd',
    padding: 24,
    paddingTop: 48,
  },
  welcomeSmall: {
    color: '#cbe2ff',
    fontSize: 16,
  },
  welcomeBig: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginVertical: 4,
  },
  subtitle: {
    color: '#cbe2ff',
    fontSize: 14,
    marginTop: 4,
  },
  bold: {
    fontWeight: '700',
    color: '#fff',
  },
  card: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  logoutButton: {
    margin: 16,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#dc3545',
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
  },
});
