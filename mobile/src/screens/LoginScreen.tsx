/**
 * Ecran de connexion — light thème haute lisibilité terrain.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { login } from '../api/authService';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';

const BG     = '#f0f4f8';
const CARD   = '#ffffff';
const INPUT  = '#f1f5f9';
const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const TEXT3  = '#64748b';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props): React.ReactElement {
  const [codeLivreur, setCodeLivreur]   = useState('');
  const [password, setPassword]         = useState('');
  const [loading, setLoading]           = useState(false);
  const [focused, setFocused]           = useState<string | null>(null);

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
      Alert.alert('Connexion impossible',
        error?.response?.data?.detail ?? 'Identifiants invalides ou serveur inaccessible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bounces={false}>

        {/* ── Logo ── */}
        <View style={styles.logoWrap}>
          <Image source={require('../../assets/logo_name.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.tagline}>Le gaz plus proche de vous</Text>
          <View style={styles.taglineLine} />
          <View style={styles.rolePillWrap}>
            <Text style={styles.rolePill}>ESPACE LIVREUR</Text>
          </View>
        </View>

        {/* ── Carte de connexion ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connexion</Text>
          <View style={styles.titleLine} />

          <Text style={styles.label}>CODE LIVREUR</Text>
          <View style={[styles.inputWrap, focused === 'code' && styles.inputWrapFocused]}>
            <TextInput
              style={styles.input}
              value={codeLivreur}
              onChangeText={setCodeLivreur}
              placeholder="LIV001"
              placeholderTextColor={TEXT3}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!loading}
              onFocus={() => setFocused('code')}
              onBlur={() => setFocused(null)}
            />
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>MOT DE PASSE</Text>
          <View style={[styles.inputWrap, focused === 'pwd' && styles.inputWrapFocused]}>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={TEXT3}
              secureTextEntry
              autoCorrect={false}
              editable={!loading}
              onFocus={() => setFocused('pwd')}
              onBlur={() => setFocused(null)}
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.82}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Se connecter</Text>}
          </TouchableOpacity>

          <Text style={styles.hint}>Démo · LIV001 / demo1234</Text>
        </View>

        <Text style={styles.footer}>SODIGAZ APC · v1.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingVertical: 48 },

  logoWrap:    { alignItems: 'center', marginBottom: 36 },
  logo:        { width: 200, height: 56, marginBottom: 10 },
  tagline:     { color: TEXT3, fontSize: 12, letterSpacing: 0.8, marginBottom: 16 },
  taglineLine: { width: 36, height: 2, borderRadius: 1, backgroundColor: Colors.brandBlue, marginBottom: 12 },
  rolePillWrap:{ backgroundColor: Colors.infoBg ?? '#e0f2fe', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 20 },
  rolePill:    { color: Colors.brandBlue, fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  card: {
    backgroundColor: CARD, borderRadius: 20, padding: 24,
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 6,
    maxWidth: 420, alignSelf: 'center', width: '100%',
  },
  cardTitle: { fontSize: 22, fontWeight: '700', color: TEXT, textAlign: 'center', marginBottom: 10 },
  titleLine: { alignSelf: 'center', width: 32, height: 3, borderRadius: 2, backgroundColor: Colors.brandBlue, marginBottom: 24 },

  label: {
    fontSize: 11, fontWeight: '700', color: TEXT3,
    letterSpacing: 1.5, marginBottom: 6,
  },
  inputWrap: {
    backgroundColor: INPUT, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
  },
  inputWrapFocused: { borderColor: Colors.brandBlue },
  input: { paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT },

  btn: {
    marginTop: 28, backgroundColor: Colors.brandOrange,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowColor: Colors.brandOrange, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 7,
  },
  btnDisabled: { opacity: 0.55 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  hint:   { textAlign: 'center', color: TEXT3, fontSize: 12, marginTop: 20 },
  footer: { textAlign: 'center', color: '#c5cfd9', fontSize: 11, marginTop: 36, letterSpacing: 1 },
});
