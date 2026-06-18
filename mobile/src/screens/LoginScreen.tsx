/**
 * Écran de connexion : carte néomorphique claire sur fond navy SODIGAZ.
 *
 * Premier écran affiché si aucun access token n'est présent en
 * SecureStore. L'utilisateur saisit son code livreur (ex. LIV001)
 * et son mot de passe. Un bouton de remplissage automatique "LIV001 ·
 * demo1234" est disponible pour les démonstrations.
 *
 * Les livreurs connaissent leur
 * code terrain (LIV001, LIV002...), pas forcément leur username Django.
 * L'identifiant terrain est plus naturel et moins sujet aux erreurs
 * de saisie sur un téléphone en extérieur.
 *
 * WHY (navigation.replace('Dashboard') et non navigate) : replace() supprime
 * LoginScreen de la pile de navigation : le bouton retour Android ne
 * ramène pas à la page de connexion une fois connecté.
 *
 * Le throttle côté Django est de 5 tentatives/min par IP.
 * On affiche un message spécifique sur 429 pour guider le livreur
 * ("réessaie dans quelques instants") plutôt qu'un générique "erreur".
 *
 * Sur iPhone SE (petit écran), la
 * carte de connexion peut être partiellement masquée par le clavier
 * virtuel. KeyboardAvoidingView lève le contenu ; ScrollView permet
 * de défiler jusqu'aux champs si l'écran est très petit.
 *
 * Utilise les couleurs officielles
 * SODIGAZ (#0a1628 navy, #079BD9 bleu, #EE7202 orange, #FAB848 ambre).
 * Les bulles flottantes rappellent l'identité graphique du logo sans
 * nécessiter expo-linear-gradient (non installé, voir CLAUDE.md §5).
 */
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

/* Palette néomorphique claire */
const NEO     = '#e8edf2';   // fond de la carte et de ses enfants
const NEO_SHD = '#b8cad8';   // ombre sombre (bas-droite)
const NEO_IN  = '#d4dde6';   // fond inset (inputs)

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props): React.ReactElement {
  const { width } = useWindowDimensions();
  const hPad    = Math.round(width * 0.09);          // ~9 % de largeur écran
  const logoW   = Math.min(Math.round(width * 0.52), 220); // 52 % écran, max 220
  const logoH   = Math.round(logoW * 0.276);          // ratio logo_name.png

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
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPad }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Décorations navy (bulles derrière la carte) */}
        <View style={[styles.bubble, styles.b1]} />
        <View style={[styles.bubble, styles.b2]} />
        <View style={[styles.bubble, styles.b3]} />

        {/* Logo au-dessus de la carte */}
        <View style={styles.logoWrap}>
          <Image
            source={require('../../assets/logo_name.png')}
            style={[styles.logo, { width: logoW, height: logoH }]}
            resizeMode="contain"
          />
          <Text style={styles.tagline}>Le gaz plus proche de vous</Text>
          <View style={styles.pill}>
            <View style={styles.pillDot} />
            <Text style={styles.pillText}>ESPACE LIVREUR</Text>
          </View>
        </View>

        {/* Carte néomorphique (raised, claire, flottante) */}
        <View style={styles.cardOuter}>
          <View style={styles.cardInner}>

            {/* Accent orange */}
            <View style={styles.handle} />

            <Text style={styles.cardTitle}>Connexion</Text>

            {/* Code livreur */}
            <Text style={styles.label}>CODE LIVREUR</Text>
            <View style={[styles.inset, focused === 'code' && styles.insetFocus]}>
              <Ionicons
                name="person-outline"
                size={18}
                color={focused === 'code' ? Colors.brandBlue : '#7a8fa0'}
              />
              <TextInput
                style={styles.fieldInput}
                value={codeLivreur}
                onChangeText={(v) => { setCodeLivreur(v); setLoginError(null); }}
                placeholder="ex : LIV001"
                placeholderTextColor="#8fa4b4"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
                onFocus={() => setFocused('code')}
                onBlur={() => setFocused(null)}
              />
            </View>

            {/* Mot de passe */}
            <Text style={[styles.label, { marginTop: 18 }]}>MOT DE PASSE</Text>
            <View style={[styles.inset, focused === 'pwd' && styles.insetFocus]}>
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={focused === 'pwd' ? Colors.brandBlue : '#7a8fa0'}
              />
              <TextInput
                style={[styles.fieldInput, { flex: 1 }]}
                value={password}
                onChangeText={(v) => { setPassword(v); setLoginError(null); }}
                placeholder="••••••••"
                placeholderTextColor="#8fa4b4"
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
                  size={18}
                  color="#7a8fa0"
                />
              </TouchableOpacity>
            </View>

            {/* Bannière d'erreur inline */}
            {loginError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={17} color={Colors.danger} style={{ marginTop: 1 }} />
                <Text style={styles.errorBannerText}>{loginError}</Text>
              </View>
            )}

            {/* Bouton Se connecter : raised orange */}
            <View style={[styles.btnOuter, loading && { opacity: 0.55 }]}>
              <TouchableOpacity
                style={styles.btnInner}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.82}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.btnText}>Se connecter</Text>
                    <Ionicons name="arrow-forward-outline" size={20} color="#fff" style={{ marginLeft: 10 }} />
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Séparateur */}
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divLabel}>accès démo</Text>
              <View style={styles.divLine} />
            </View>

            {/* Démo : texte simple tap-to-fill */}
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
  root:   { flex: 1, backgroundColor: Colors.navy },
  scroll: {
    flexGrow:        1,
    justifyContent:  'center',
    alignItems:      'center',
    paddingVertical: 48,
    /* paddingHorizontal injecté dynamiquement via useWindowDimensions */
  },

  /* Bulles décoratives sur fond navy */
  bubble: { position: 'absolute', borderRadius: 999 },
  b1: { width: 280, height: 280, top: -60,  right: -80, backgroundColor: Colors.brandBlue,   opacity: 0.07 },
  b2: { width: 180, height: 180, bottom: 40, left: -60,  backgroundColor: Colors.brandOrange, opacity: 0.06 },
  b3: { width: 110, height: 110, top: 120,  left:  30,  backgroundColor: Colors.brandAmber,  opacity: 0.05 },

  /* Logo */
  logoWrap: { alignItems: 'center', marginBottom: 32, width: '100%' },
  logo:     { marginBottom: 10 },
  tagline:  { color: 'rgba(255,255,255,0.45)', fontSize: scale(13), letterSpacing: 0.6, marginBottom: 14 },
  pill: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   'rgba(7,155,217,0.12)',
    borderWidth:       1,
    borderColor:       'rgba(7,155,217,0.3)',
    paddingHorizontal: 16,
    paddingVertical:    6,
    borderRadius:      999,
  },
  pillDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.brandBlue, marginRight: 8 },
  pillText: { color: Colors.brandBlue, fontSize: scale(11), fontWeight: '700', letterSpacing: 2 },

  /* Carte raised : double ombre */
  cardOuter: {
    width:           '100%',
    maxWidth:        460,    // plafond tablette
    alignSelf:       'center',
    borderRadius:    24,
    backgroundColor: NEO,
    shadowColor:     NEO_SHD,
    shadowOffset:    { width: 10, height: 10 },
    shadowOpacity:   0.65,
    shadowRadius:    20,
    elevation:       8,
  },
  cardInner: {
    borderRadius:    24,
    backgroundColor: NEO,
    shadowColor:     '#ffffff',
    shadowOffset:    { width: -8, height: -8 },
    shadowOpacity:   0.9,
    shadowRadius:    16,
    padding:         22,
  },

  handle: {
    alignSelf:       'center',
    marginBottom:    22,
    width:           40,
    height:           4,
    borderRadius:     2,
    backgroundColor: Colors.brandOrange,
  },
  cardTitle: { fontSize: scale(24), fontWeight: '800', color: '#1a2a3a', marginBottom: 22, textAlign: 'center' },

  /* Labels */
  label: {
    fontSize: scale(11),
    fontWeight:    '700',
    color:         '#5a7080',
    letterSpacing: 1.5,
    marginBottom:   8,
  },

  /* Inset (concave) : fond sombre + bordures asymétriques */
  inset: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   NEO_IN,
    borderRadius:      12,
    borderTopWidth:    1.5,
    borderLeftWidth:   1.5,
    borderBottomWidth: 1.5,
    borderRightWidth:  1.5,
    borderTopColor:    '#a8bac8',
    borderLeftColor:   '#a8bac8',
    borderBottomColor: '#f4f8fb',
    borderRightColor:  '#f4f8fb',
    paddingHorizontal: 16,
    height:            56,
    gap:               12,
  },
  insetFocus: {
    borderTopColor:    Colors.brandBlue,
    borderLeftColor:   Colors.brandBlue,
    borderBottomColor: '#b0daf2',
    borderRightColor:  '#b0daf2',
    backgroundColor:   '#cce6f4',
  },
  fieldInput: { flex: 1, fontSize: scale(15), color: '#1a2a3a', paddingVertical: 0 },

  /* Bouton raised orange : effet sortant néomorphique */
  btnOuter: {
    marginTop:       24,
    borderRadius:    14,
    backgroundColor: Colors.brandOrange,
    /* Ombre sombre bas-droite : donne le relief */
    shadowColor:     '#5c1a00',
    shadowOffset:    { width: 9, height: 9 },
    shadowOpacity:   0.7,
    shadowRadius:    14,
    elevation:       12,
  },
  btnInner: {
    borderRadius:    14,
    backgroundColor: Colors.brandOrange,
    height:          58,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    /* Highlight clair haut-gauche */
    shadowColor:     '#ffcc66',
    shadowOffset:    { width: -6, height: -6 },
    shadowOpacity:   0.7,
    shadowRadius:    12,
    /* Biseau : bords haut-gauche clairs, bas-droite sombres */
    borderTopWidth:    1.5,
    borderLeftWidth:   1.5,
    borderBottomWidth: 1.5,
    borderRightWidth:  1.5,
    borderTopColor:    '#ffb060',
    borderLeftColor:   '#ffb060',
    borderBottomColor: '#b83a00',
    borderRightColor:  '#b83a00',
  },
  btnText: { color: '#fff', fontSize: scale(16), fontWeight: '700', letterSpacing: 0.4 },

  /* Séparateur */
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  divLine:  { flex: 1, height: 1, backgroundColor: '#c8d4de' },
  divLabel: { fontSize: scale(11), color: '#8aa0b0', letterSpacing: 1 },

  demoText: { fontSize: scale(12), color: Colors.brandBlue, fontWeight: '500', textAlign: 'center' },

  footer: { color: 'rgba(255,255,255,0.2)', fontSize: scale(11), marginTop: 28, letterSpacing: 1 },

  /* Bannière erreur : raised danger dans la carte NEO */
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 18, padding: 12, borderRadius: 10,
    backgroundColor: Colors.dangerBg,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#fdd',              borderLeftColor: '#fdd',
    borderBottomColor: Colors.dangerBorder, borderRightColor: Colors.dangerBorder,
  },
  errorBannerText: { flex: 1, fontSize: scale(13), color: Colors.danger, lineHeight: 18 },
});
