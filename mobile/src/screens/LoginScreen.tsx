/**
 * Ecran de connexion.
 * Saisie du code livreur + mot de passe, envoi au back-end JWT.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

  const [focusedField, setFocusedField] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* En-tête navy brandé */}
      <View style={styles.brandHeader}>
        <Image
          source={require('../../assets/logo_name.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.brandSub}>Espace livreur</Text>
      </View>

      {/* Formulaire */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connexion</Text>

        <Text style={styles.label}>Code livreur</Text>
        <TextInput
          style={[styles.input, focusedField === 'code' && styles.inputFocused]}
          value={codeLivreur}
          onChangeText={setCodeLivreur}
          onFocus={() => setFocusedField('code')}
          onBlur={() => setFocusedField(null)}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="LIV001"
          placeholderTextColor="#bbb"
          editable={!loading}
        />

        <Text style={styles.label}>Mot de passe</Text>
        <TextInput
          style={[styles.input, focusedField === 'pwd' && styles.inputFocused]}
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocusedField('pwd')}
          onBlur={() => setFocusedField(null)}
          secureTextEntry
          autoCorrect={false}
          placeholder="••••••••"
          placeholderTextColor="#bbb"
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

        <Text style={styles.hint}>Démo : LIV001 / @demo12345</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1628',
    justifyContent: 'center',
    padding: 20,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 200,
    height: 60,
    marginBottom: 8,
  },
  brandSub: {
    color: '#8daec8',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a2332',
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 5,
    marginTop: 12,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#fafafa',
    color: '#1a2332',
  },
  inputFocused: {
    borderColor: '#1a7fba',
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#1a7fba',
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
    fontWeight: '700',
  },
  hint: {
    textAlign: 'center',
    color: '#aaa',
    fontSize: 12,
    marginTop: 16,
  },
});
