#!/bin/bash
# =============================================================================
# Sprint 1 du mobile : setup Expo TypeScript + login JWT + navigation
# Usage : depuis ~/sodigaz_poc (le repertoire RACINE du depot), bash install_mobile_sprint1.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : ce script doit etre execute depuis ~/sodigaz_poc"
    echo "(la ou se trouve manage.py)"
    exit 1
fi

# =============================================================================
echo ""
echo "=== Etape 1 : verification / installation de Node.js via NVM ==="

if ! command -v nvm &> /dev/null && [ ! -d "$HOME/.nvm" ]; then
    echo "Installation de NVM (Node Version Manager)..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    echo "NVM installe."
else
    echo "NVM deja present."
fi

# Charger NVM dans le shell courant
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Installation de Node 20 LTS si pas deja la
if ! nvm list | grep -q "v20"; then
    echo "Installation de Node 20 LTS..."
    nvm install 20
    nvm alias default 20
else
    echo "Node 20 deja present."
fi
nvm use 20

echo "Versions installees :"
node --version
npm --version

# =============================================================================
echo ""
echo "=== Etape 2 : creation du projet Expo dans mobile/ ==="

if [ -d "mobile" ]; then
    echo "Le dossier mobile/ existe deja. Je n'ecrase rien."
    echo "Si tu veux repartir de zero : 'rm -rf mobile' puis relance ce script."
    exit 1
fi

# Note : on utilise le template blank-typescript qui donne une structure minimale
# (sans router file-based, qu'on configurera manuellement plus tard).
# Le flag --yes accepte les defauts pour eviter les prompts interactifs.
npx --yes create-expo-app@latest mobile --template blank-typescript

cd mobile

# =============================================================================
echo ""
echo "=== Etape 3 : installation des dependances ==="

# React Navigation : navigation native entre ecrans
npx expo install \
    @react-navigation/native@^7.0.0 \
    @react-navigation/native-stack@^7.0.0 \
    react-native-screens \
    react-native-safe-area-context

# Stockage securise des tokens JWT
npx expo install expo-secure-store

# Axios pour les appels HTTP au back-end
npm install axios

# Constants pour acceder a expoConfig.extra (variables d'environnement)
npx expo install expo-constants

# =============================================================================
echo ""
echo "=== Etape 4 : creation de la structure du projet ==="

mkdir -p src/{api,components,navigation,screens,storage,types,config}

# -----------------------------------------------------------------------------
# Types TypeScript : les interfaces des donnees
# -----------------------------------------------------------------------------
cat > src/types/auth.ts << 'TSEOF'
/**
 * Types lies a l'authentification JWT.
 */

export interface LoginCredentials {
  code_livreur: string;
  password: string;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface UtilisateurInfo {
  id: number;
  username: string;
  code_livreur: string | null;
  first_name: string;
  last_name: string;
  telephone: string;
  role: 'LIVREUR' | 'SUPERVISEUR' | 'ADMIN';
  is_active: boolean;
}
TSEOF

# -----------------------------------------------------------------------------
# Types de navigation
# -----------------------------------------------------------------------------
cat > src/types/navigation.ts << 'TSEOF'
/**
 * Cartographie des ecrans de l'application.
 * Permet a TypeScript de typer les navigations entre ecrans.
 */

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  // Sprint 2 ajoutera : Programme, Etape, Operation, etc.
};
TSEOF

# -----------------------------------------------------------------------------
# Configuration de l'URL du back-end (override par variable d'env)
# -----------------------------------------------------------------------------
cat > src/config/api.ts << 'TSEOF'
/**
 * Configuration de l'URL de l'API back-end.
 *
 * - En dev local sur navigateur (Expo Web) : localhost fonctionne car le
 *   navigateur et le serveur Django sont sur la meme machine.
 * - En dev sur telephone physique : il faudra remplacer par l'IP du PC
 *   sur le reseau local (ex. http://192.168.1.42:8000).
 *
 * Pour faciliter le changement, on lit EXPO_PUBLIC_API_URL depuis
 * l'environnement. Cree un fichier .env a la racine de mobile/ avec :
 *   EXPO_PUBLIC_API_URL=http://192.168.1.42:8000
 * Expo charge ce fichier automatiquement.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
TSEOF

# -----------------------------------------------------------------------------
# Stockage securise (web vs mobile)
# -----------------------------------------------------------------------------
cat > src/storage/secureStorage.ts << 'TSEOF'
/**
 * Couche d'abstraction sur le stockage securise.
 *
 * - Sur mobile (iOS/Android) : utilise expo-secure-store (Keychain sur iOS,
 *   KeyStore sur Android), qui chiffre les valeurs au niveau de l'OS.
 * - Sur web : expo-secure-store n'est pas disponible. On retombe sur
 *   localStorage, qui n'est PAS securise (un script malveillant pourrait
 *   le lire). Acceptable pour le developpement Expo Web, surtout pas
 *   pour la production.
 *
 * Pour la version mobile cible, c'est expo-secure-store qui sera utilise.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

export async function saveItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

// Cles utilisees dans l'app
export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const;
TSEOF

# -----------------------------------------------------------------------------
# Client API : axios configure avec l'URL de base et l'auth
# -----------------------------------------------------------------------------
cat > src/api/client.ts << 'TSEOF'
/**
 * Client HTTP axios pre-configure.
 *
 * Inclut :
 *   - URL de base (API_BASE_URL)
 *   - Intercepteur qui ajoute le token JWT a chaque requete authentifiee
 *   - (Sprint 2) Intercepteur qui rafraichit le token sur 401
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import { API_BASE_URL } from '../config/api';
import { getItem, STORAGE_KEYS } from '../storage/secureStorage';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur : ajoute le token JWT a chaque requete sortante
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getItem(STORAGE_KEYS.ACCESS_TOKEN);
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

export default apiClient;
TSEOF

# -----------------------------------------------------------------------------
# Service d'authentification
# -----------------------------------------------------------------------------
cat > src/api/authService.ts << 'TSEOF'
/**
 * Service d'authentification : login, logout, recuperation du profil.
 */
import apiClient from './client';
import {
  LoginCredentials,
  TokenPair,
  UtilisateurInfo,
} from '../types/auth';
import { getItem, removeItem, saveItem, STORAGE_KEYS } from '../storage/secureStorage';

export async function login(credentials: LoginCredentials): Promise<TokenPair> {
  const response = await apiClient.post<TokenPair>(
    '/api/auth/login/',
    credentials,
  );
  // Stockage des tokens
  await saveItem(STORAGE_KEYS.ACCESS_TOKEN, response.data.access);
  await saveItem(STORAGE_KEYS.REFRESH_TOKEN, response.data.refresh);
  return response.data;
}

export async function logout(): Promise<void> {
  await removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  await removeItem(STORAGE_KEYS.REFRESH_TOKEN);
}

export async function fetchMe(): Promise<UtilisateurInfo> {
  const response = await apiClient.get<UtilisateurInfo>('/api/auth/me/');
  return response.data;
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getItem(STORAGE_KEYS.ACCESS_TOKEN);
  return token !== null;
}
TSEOF

# -----------------------------------------------------------------------------
# Ecran Login
# -----------------------------------------------------------------------------
cat > src/screens/LoginScreen.tsx << 'TSEOF'
/**
 * Ecran de connexion.
 * Saisie du code livreur + mot de passe, envoi au back-end JWT.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { login } from '../api/authService';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props): React.ReactElement {
  const [codeLivreur, setCodeLivreur] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  async function handleLogin(): Promise<void> {
    if (!codeLivreur.trim() || !password.trim()) {
      Alert.alert('Champs manquants', 'Saisis ton code livreur et ton mot de passe.');
      return;
    }
    setLoading(true);
    try {
      await login({ code_livreur: codeLivreur.trim(), password });
      navigation.replace('Dashboard');
    } catch (error: any) {
      const detail =
        error?.response?.data?.detail ?? 'Identifiants invalides ou serveur inaccessible.';
      Alert.alert('Connexion impossible', detail);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>SODIGAZ Livraison</Text>
        <Text style={styles.subtitle}>Connexion livreur</Text>

        <Text style={styles.label}>Code livreur</Text>
        <TextInput
          style={styles.input}
          value={codeLivreur}
          onChangeText={setCodeLivreur}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="LIV001"
          editable={!loading}
        />

        <Text style={styles.label}>Mot de passe</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCorrect={false}
          placeholder="********"
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Se connecter</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>Demo : LIV001 / demo1234</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0d6efd',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#0d6efd',
    padding: 14,
    borderRadius: 8,
    marginTop: 24,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    textAlign: 'center',
    color: '#888',
    fontSize: 12,
    marginTop: 16,
  },
});
TSEOF

# -----------------------------------------------------------------------------
# Ecran Dashboard (squelette, sera enrichi au Sprint 2)
# -----------------------------------------------------------------------------
cat > src/screens/DashboardScreen.tsx << 'TSEOF'
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
TSEOF

# -----------------------------------------------------------------------------
# Navigation racine
# -----------------------------------------------------------------------------
cat > src/navigation/RootNavigator.tsx << 'TSEOF'
/**
 * Stack de navigation racine.
 * Determine au demarrage si l'utilisateur est deja connecte.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import { isAuthenticated } from '../api/authService';
import { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator(): React.ReactElement {
  const [initialRoute, setInitialRoute] = useState<'Login' | 'Dashboard' | null>(null);

  useEffect(() => {
    isAuthenticated().then((auth) => {
      setInitialRoute(auth ? 'Dashboard' : 'Login');
    });
  }, []);

  if (initialRoute === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
TSEOF

# -----------------------------------------------------------------------------
# Point d'entree de l'app
# -----------------------------------------------------------------------------
cat > App.tsx << 'TSEOF'
import React from 'react';
import { StatusBar } from 'expo-status-bar';

import RootNavigator from './src/navigation/RootNavigator';

export default function App(): React.ReactElement {
  return (
    <>
      <StatusBar style="light" />
      <RootNavigator />
    </>
  );
}
TSEOF

# -----------------------------------------------------------------------------
# .gitignore specifique au mobile
# -----------------------------------------------------------------------------
cat > .gitignore << 'EOF'
# Dependencies
node_modules/

# Expo
.expo/
.expo-shared/
dist/
web-build/

# Native
*.apk
*.aab
*.ipa
ios/
android/

# Build
.gradle/
build/

# Metro
.metro-health-check*

# Logs
*.log
npm-debug.*
yarn-debug.*
yarn-error.*

# Env
.env
.env.local

# IDE
.vscode/
.idea/
*.swp
*.DS_Store
EOF

# -----------------------------------------------------------------------------
# Fichier .env de developpement (a personnaliser selon ton IP locale)
# -----------------------------------------------------------------------------
cat > .env.example << 'EOF'
# URL du back-end Django.
# - Sur navigateur Chrome (Expo Web) en local : localhost suffit
# - Sur telephone physique : utilise l'IP de ton PC sur le reseau local
#   (commande 'ipconfig' sous Windows pour la trouver)
EXPO_PUBLIC_API_URL=http://localhost:8000
EOF
cp .env.example .env

cd ..

# =============================================================================
echo ""
echo "=============================================="
echo "SPRINT 1 - SETUP TERMINE."
echo "=============================================="
echo ""
echo "Etapes pour tester :"
echo ""
echo "  1. Dans un terminal, lance le back-end Django sur toutes les interfaces :"
echo "     cd ~/sodigaz_poc"
echo "     source venv/bin/activate"
echo "     python manage.py runserver 0.0.0.0:8000"
echo ""
echo "  2. Dans un autre terminal, lance le mobile :"
echo "     cd ~/sodigaz_poc/mobile"
echo "     npx expo start --web"
echo ""
echo "  3. Ton navigateur s'ouvrira sur l'app."
echo "     Saisis LIV001 / demo1234 et clique sur 'Se connecter'."
echo ""
echo "Si tu prefereras tester sur telephone plus tard :"
echo "     npx expo start  (sans --web)"
echo "     puis scanne le QR code avec l'app Expo Go"
echo ""
