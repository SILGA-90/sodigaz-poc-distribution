import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { login } from '../api/authService';
import { RootStackParamList } from '../types/navigation';
import { Colors, scale } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props): React.ReactElement {
  const { width } = useWindowDimensions();
  const logoW = Math.min(Math.round(width * 0.52), 220);
  const logoH = Math.round(logoW * 0.276);

  const [codeLivreur, setCodeLivreur] = useState('');
  const [password, setPassword]       = useState('');
  const [loading, setLoading]         = useState(false);
  const [focused, setFocused]         = useState<string | null>(null);
  const [showPwd, setShowPwd]         = useState(false);
  const [loginError, setLoginError]   = useState<string | null>(null);

  async function handleLogin(): Promise<void> {
    if (!codeLivreur.trim() || !password.trim()) {
      setLoginError('Saisis ton code livreur et ton mot de passe.');
      return;
    }
    setLoginError(null);
    setLoading(true);
    try {
      await login({ code_livreur: codeLivreur.trim(), password });
      navigation.replace('Dashboard');
    } catch (error: any) {
      if (error?.response?.status === 429) {
        setLoginError('Trop de tentatives : réessaie dans quelques instants.');
      } else {
        setLoginError(error?.response?.data?.detail ?? 'Identifiants invalides ou serveur inaccessible.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor={Colors.navy} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Bulles décoratives navy */}
        <View style={[styles.bubble, styles.b1]} />
        <View style={[styles.bubble, styles.b2]} />
        <View style={[styles.bubble, styles.b3]} />

        {/* Logo + tagline + badge */}
        <View style={styles.logoWrap}>
          <Image
            source={require('../../assets/logo_name.png')}
            style={[styles.logo, { width: logoW, height: logoH }]}
            resizeMode="contain"
          />
          <Text style={styles.tagline}>Le gaz plus proche de vous</Text>
          <View style={styles.pill}>
            <Ionicons name="car-outline" size={13} color={Colors.brandOrange} />
            <Text style={styles.pillText}>LIVREUR</Text>
          </View>
        </View>

        {/* Carte — surface blanche franche, ombre portée douce */}
        <View style={styles.card}>

          {/* Barre accent orange — signature marque, non néomorphique */}
          <View style={styles.accentBar} />

          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Connexion</Text>

            {/* Code livreur */}
            <Text style={styles.label}>CODE LIVREUR</Text>
            <View style={[styles.inputWrap, focused === 'code' && styles.inputWrapFocus]}>
              <Ionicons
                name="person-outline" size={18}
                color={focused === 'code' ? Colors.brandBlue : '#8094a0'}
              />
              <TextInput
                style={styles.fieldInput}
                value={codeLivreur}
                onChangeText={(v) => { setCodeLivreur(v); setLoginError(null); }}
                placeholder="ex : LIV001"
                placeholderTextColor="#a0b4be"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
                onFocus={() => setFocused('code')}
                onBlur={() => setFocused(null)}
              />
            </View>

            {/* Mot de passe */}
            <Text style={[styles.label, { marginTop: 16 }]}>MOT DE PASSE</Text>
            <View style={[styles.inputWrap, focused === 'pwd' && styles.inputWrapFocus]}>
              <Ionicons
                name="lock-closed-outline" size={18}
                color={focused === 'pwd' ? Colors.brandBlue : '#8094a0'}
              />
              <TextInput
                style={[styles.fieldInput, { flex: 1 }]}
                value={password}
                onChangeText={(v) => { setPassword(v); setLoginError(null); }}
                placeholder="••••••••"
                placeholderTextColor="#a0b4be"
                secureTextEntry={!showPwd}
                autoCorrect={false}
                editable={!loading}
                onFocus={() => setFocused('pwd')}
                onBlur={() => setFocused(null)}
              />
              <TouchableOpacity
                onPress={() => setShowPwd(v => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showPwd ? 'eye-off-outline' : 'eye-outline'}
                  size={18} color="#8094a0"
                />
              </TouchableOpacity>
            </View>

            {/* Bannière d'erreur */}
            {loginError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={17} color={Colors.danger} style={{ marginTop: 1 }} />
                <Text style={styles.errorBannerText}>{loginError}</Text>
              </View>
            )}

            {/* Bouton principal — orange plein, contraste fort */}
            <TouchableOpacity
              style={[styles.btn, loading && { opacity: 0.55 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.82}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.btnText}>Se connecter</Text>
                  <Ionicons name="arrow-forward-outline" size={20} color="#fff" style={{ marginLeft: 8 }} />
                </>
              )}
            </TouchableOpacity>

            {/* Séparateur démo */}
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divLabel}>accès démo</Text>
              <View style={styles.divLine} />
            </View>

            <TouchableOpacity
              onPress={() => { setCodeLivreur('LIV001'); setPassword('demo1234'); }}
              activeOpacity={0.6}
            >
              <Text style={styles.demoText}>LIV001 · demo1234</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.footer}>SODIGAZ APC · v1.0 · POC</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.navy },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },

  /* Bulles décoratives (identité marque, fond navy) */
  bubble: { position: 'absolute', borderRadius: 999 },
  b1: { width: 280, height: 280, top: -60,  right: -80, backgroundColor: Colors.brandBlue,   opacity: 0.07 },
  b2: { width: 180, height: 180, bottom: 40, left: -60,  backgroundColor: Colors.brandOrange, opacity: 0.06 },
  b3: { width: 110, height: 110, top: 120,  left:  30,  backgroundColor: Colors.brandAmber,  opacity: 0.05 },

  /* Zone logo */
  logoWrap: { alignItems: 'center', marginBottom: 28, width: '100%' },
  logo:     { marginBottom: 10 },
  tagline:  { color: 'rgba(255,255,255,0.45)', fontSize: scale(13), letterSpacing: 0.6, marginBottom: 14 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(238,114,2,0.14)',
    borderWidth: 1, borderColor: 'rgba(238,114,2,0.35)',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
  },
  pillText: { color: Colors.brandOrange, fontSize: scale(11), fontWeight: '700', letterSpacing: 2 },

  /* Carte — une seule couche, blanche, ombre portée discrète */
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.13,
    shadowRadius: 16,
    elevation: 6,
    overflow: 'hidden',
  },

  /* Barre accent orange (4 px, pas de relief) */
  accentBar: { height: 4, backgroundColor: Colors.brandOrange },

  cardBody:  { padding: 24 },
  cardTitle: { fontSize: scale(22), fontWeight: '800', color: '#1F2933', marginBottom: 24 },

  /* Labels — assez foncés pour le plein soleil */
  label: {
    fontSize: scale(11), fontWeight: '700',
    color: '#3D4F5C', letterSpacing: 1.5, marginBottom: 8,
  },

  /* Champs de saisie — bordure franche, pas de relief asymétrique */
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5, borderColor: '#DDE2E6',
    paddingHorizontal: 14, height: 52, gap: 12,
  },
  inputWrapFocus: {
    borderColor: Colors.brandBlue,
    backgroundColor: Colors.primaryLight,
  },
  fieldInput: { flex: 1, fontSize: scale(15), color: '#1F2933', paddingVertical: 0 },

  /* Bouton principal — orange plein, hauteur ≥ 48, contraste maximal */
  btn: {
    marginTop: 24,
    borderRadius: 12,
    backgroundColor: Colors.brandOrange,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontSize: scale(16), fontWeight: '700', letterSpacing: 0.4 },

  /* Séparateur */
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  divLine:  { flex: 1, height: 1, backgroundColor: '#DDE2E6' },
  divLabel: { fontSize: scale(11), color: '#8094a0', letterSpacing: 1 },
  demoText: { fontSize: scale(12), color: Colors.brandBlue, fontWeight: '500', textAlign: 'center' },

  footer: { color: 'rgba(255,255,255,0.2)', fontSize: scale(11), marginTop: 28, letterSpacing: 1 },

  /* Bannière d'erreur */
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 16, padding: 12, borderRadius: 8,
    backgroundColor: Colors.dangerBg,
    borderWidth: 1, borderColor: Colors.dangerBorder,
  },
  errorBannerText: { flex: 1, fontSize: scale(13), color: Colors.danger, lineHeight: 18 },
});
