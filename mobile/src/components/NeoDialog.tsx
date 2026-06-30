/**
 * NeoDialog : modal de confirmation.
 *
 * Ce composant remplace Alert.alert() pour les confirmations importantes
 * ou destructives. Il affiche une carte centrée avec icône
 * optionnelle, titre, message et deux boutons (Annuler / Confirmer).
 * Le bouton Confirmer peut être en rouge (prop `danger`) ou bleu (défaut).
 *
 * Alert.alert() est non stylable : boutons grisés
 * système, aucun contrôle de la mise en page, icône impossible.
 * NeoDialog garde le même comportement (confirmation bloquante) avec un
 * rendu cohérent avec le design SODIGAZ (couleurs de marque).
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

const TEXT  = '#1a2a3a';
const TEXT2 = '#3a5060';

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
  const confirmBg = danger ? Colors.danger : Colors.brandBlue;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.card}>

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

                {/* Annuler (masqué en mode singleButton) */}
                {!singleButton && (
                  <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
                    <Text style={styles.cancelText}>{cancelLabel}</Text>
                  </TouchableOpacity>
                )}

                {/* Confirmer */}
                <TouchableOpacity
                  style={[styles.confirmBtn, singleButton && styles.confirmFull, { backgroundColor: confirmBg }]}
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

  card: {
    width: '100%', maxWidth: 340,
    borderRadius: 20, backgroundColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 20,
    padding: 22, alignItems: 'center',
    borderWidth: 1, borderColor: '#DDE2E6',
  },

  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#DDE2E6',
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

  /* Annuler */
  cancelBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    backgroundColor: '#F2F4F6', borderWidth: 1, borderColor: '#DDE2E6',
  },
  cancelText: { fontSize: scale(14), fontWeight: '700', color: TEXT2 },

  /* Confirmer */
  confirmBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 5,
  },
  confirmFull: { flex: 1 },
  confirmText: { fontSize: scale(14), fontWeight: '800', color: '#fff' },
});
