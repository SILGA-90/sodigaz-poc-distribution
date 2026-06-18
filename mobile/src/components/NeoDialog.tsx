/**
 * NeoDialog : modal de confirmation en néomorphisme clair.
 *
 * Ce composant remplace Alert.alert() pour les confirmations importantes
 * ou destructives. Il affiche une carte néomorphique centrée avec icône
 * optionnelle, titre, message et deux boutons (Annuler / Confirmer).
 * Le bouton Confirmer peut être en rouge (prop `danger`) ou bleu (défaut).
 *
 * Alert.alert() est non stylable : boutons grisés
 * système, aucun contrôle de la mise en page, icône impossible.
 * NeoDialog garde le même comportement (confirmation bloquante) avec un
 * rendu cohérent avec le design SODIGAZ (néomorphisme, couleurs de marque).
 *
 * Le design néomorphique (surfaces gonflées avec ombres
 * doubles claires/sombres) donne un aspect tactile et premium sans
 * bibliothèque de composants externe. Compatible Expo Go avec StyleSheet
 * standard.
 *
 * Certaines confirmations déclenchent une action réseau
 * (ex. clôture de programme). On affiche un spinner à la place du texte
 * du bouton Confirmer pendant l'appel réseau pour indiquer que l'action
 * est en cours et éviter les doubles appuis.
 *
 * Taper en dehors de la carte
 * est équivalent à annuler : comportement standard iOS/Android pour les
 * modals non-destructives. Pour les actions destructives, onCancel est
 * une fonction no-op qui ne ferme pas le dialog (à la charge de l'appelant).
 */
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, scale } from '../theme';

const NEO     = '#e8edf2';
const NEO_SHD = '#4a6880';
const TEXT    = '#1a2a3a';
const TEXT2   = '#3a5060';

interface Props {
  visible:       boolean;
  icon?:         React.ComponentProps<typeof Ionicons>['name'];
  iconColor?:    string;
  title:         string;
  message:       string;
  confirmLabel?: string;
  cancelLabel?:  string;
  /** Bouton de confirmation en rouge (action destructive) */
  danger?:       boolean;
  /** Affiche un spinner à la place du texte du bouton confirm */
  loading?:      boolean;
  /** N'affiche que le bouton de confirmation (pleine largeur) — pour les alertes info/erreur sans choix */
  singleButton?: boolean;
  onConfirm:     () => void;
  onCancel:      () => void;
}

export default function NeoDialog({
  visible, icon, iconColor, title, message,
  confirmLabel = 'Confirmer', cancelLabel = 'Annuler',
  danger = false, loading = false, singleButton = false,
  onConfirm, onCancel,
}: Props): React.ReactElement {
  const confirmBg     = danger ? Colors.danger       : Colors.brandBlue;
  const confirmShdD   = danger ? '#991b1b'           : '#046a96';
  const confirmShdL   = danger ? '#fca5a5'           : '#7dd3fa';
  const confirmBorderT= danger ? '#fca5a5'           : '#2bb8ef';
  const confirmBorderB= danger ? '#991b1b'           : '#046a96';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.cardOuter}>
              <View style={styles.cardInner}>

                {/* Handle */}
                <View style={styles.handle} />

                {/* Icône optionnelle */}
                {icon && (
                  <View style={[styles.iconBox, { borderColor: (iconColor ?? Colors.brandBlue) + '40', backgroundColor: (iconColor ?? Colors.brandBlue) + '18' }]}>
                    <Ionicons name={icon} size={26} color={iconColor ?? Colors.brandBlue} />
                  </View>
                )}

                {/* Textes */}
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.message}>{message}</Text>

                {/* Boutons */}
                <View style={styles.btnRow}>

                  {/* Annuler : raised NEO (masqué en mode singleButton) */}
                  {!singleButton && (
                    <View style={styles.cancelOuter}>
                      <TouchableOpacity style={styles.cancelInner} onPress={onCancel} activeOpacity={0.8}>
                        <Text style={styles.cancelText}>{cancelLabel}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Confirmer : raised coloré */}
                  <View style={[styles.confirmOuter, singleButton && styles.confirmFull, { backgroundColor: confirmBg, shadowColor: confirmShdD }]}>
                    <TouchableOpacity
                      style={[styles.confirmInner, { backgroundColor: confirmBg, shadowColor: confirmShdL, borderTopColor: confirmBorderT, borderLeftColor: confirmBorderT, borderBottomColor: confirmBorderB, borderRightColor: confirmBorderB }]}
                      onPress={onConfirm}
                      disabled={loading}
                      activeOpacity={0.85}
                    >
                      {loading
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.confirmText}>{confirmLabel}</Text>
                      }
                    </TouchableOpacity>
                  </View>

                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,22,40,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },

  /* Carte raised centrée */
  cardOuter: {
    width: '100%', maxWidth: 340,
    borderRadius: 20, backgroundColor: NEO,
    shadowColor: NEO_SHD,
    shadowOffset: { width: 8, height: 8 },
    shadowOpacity: 1, shadowRadius: 14, elevation: 20,
  },
  cardInner: {
    borderRadius: 20, backgroundColor: NEO,
    shadowColor: '#ffffff',
    shadowOffset: { width: -6, height: -6 },
    shadowOpacity: 1, shadowRadius: 10,
    padding: 22,
    borderTopWidth: 1.5, borderLeftWidth: 1.5,
    borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
    alignItems: 'center',
  },

  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: NEO_SHD + '40',
    marginBottom: 18,
  },

  iconBox: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 16,
  },

  title:   { fontSize: scale(17), fontWeight: '800', color: TEXT,  textAlign: 'center', marginBottom: 8, letterSpacing: -0.2 },
  message: { fontSize: scale(14), color: TEXT2, textAlign: 'center', lineHeight: 20, marginBottom: 24 },

  btnRow: { flexDirection: 'row', gap: 10, width: '100%' },

  /* Annuler : raised NEO */
  cancelOuter: {
    flex: 1, borderRadius: 12, backgroundColor: NEO,
    shadowColor: NEO_SHD,
    shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 6, elevation: 6,
  },
  cancelInner: {
    borderRadius: 12, backgroundColor: NEO,
    paddingVertical: 14, alignItems: 'center',
    shadowColor: '#ffffff',
    shadowOffset: { width: -3, height: -3 }, shadowOpacity: 1, shadowRadius: 5,
    borderTopWidth: 1.5, borderLeftWidth: 1.5,
    borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#ffffff', borderLeftColor: '#ffffff',
    borderBottomColor: '#8aa8c0', borderRightColor: '#8aa8c0',
  },
  cancelText: { fontSize: scale(14), fontWeight: '700', color: TEXT2 },

  /* Confirmer : raised coloré */
  confirmOuter: {
    flex: 1, borderRadius: 12,
    shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.65, shadowRadius: 8, elevation: 8,
  },
  confirmFull: { flex: 1 },
  confirmInner: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.45, shadowRadius: 6,
    borderTopWidth: 1.5, borderLeftWidth: 1.5,
    borderBottomWidth: 1.5, borderRightWidth: 1.5,
  },
  confirmText: { fontSize: scale(14), fontWeight: '800', color: '#fff' },
});
