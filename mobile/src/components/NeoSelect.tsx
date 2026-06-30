/**
 * NeoSelect : dropdown custom en néomorphisme clair.
 *
 * Ce composant remplace @react-native-picker/picker avec un trigger
 * inset + modal flottant (bottom sheet). Il expose la même interface
 * qu'un select HTML (value, onChange, options) mais avec un style
 * cohérent avec le design SODIGAZ (néomorphisme, couleurs de marque).
 *
 * Le picker natif Android/iOS
 * est non stylable : couleurs système, police non configurable, rendu
 * incohérent entre plateformes. NeoSelect offre un rendu identique
 * sur iOS et Android avec les couleurs de marque SODIGAZ.
 *
 * Le bottom sheet est le pattern UX standard
 * mobile pour les sélections de liste. Il est plus lisible qu'un
 * dropdown inline qui décale le contenu de la page, et plus grand
 * qu'une liste déroulante (meilleures cibles tactiles en plein soleil).
 *
 * Pour une liste d'options longue, FlatList
 * est plus performant qu'un ScrollView avec map() : seules les options
 * visibles sont rendues (virtualisation). Sur Android milieu de gamme
 * avec 20+ options, la différence est notable.
 *
 * Taper en dehors du bottom
 * sheet est équivalent à annuler : comportement standard modal mobile.
 */
import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, scale } from '../theme';

const NEO_IN = '#E8EEF2';
const TEXT   = '#1a2a3a';
const TEXT2  = '#3a5060';
const TEXT3  = '#5B6770';

export interface NeoSelectOption {
  label: string;
  value: string | number | null;
}

interface Props {
  value: string | number | null;
  onChange: (v: string | number | null) => void;
  options: NeoSelectOption[];
  placeholder?: string;
  style?: object;
}

export default function NeoSelect({ value, onChange, options, placeholder = 'Sélectionner...', style }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);
  const label    = selected ? selected.label : placeholder;
  const hasValue = selected != null;

  return (
    <>
      {/* Trigger inset */}
      <TouchableOpacity
        style={[styles.trigger, style]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
      >
        <Text style={[styles.triggerText, !hasValue && styles.triggerPlaceholder]} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-down" size={16} color={hasValue ? Colors.brandBlue : TEXT3} />
      </TouchableOpacity>

      {/* Modal flottant */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.sheet}>

                  {/* Handle */}
                  <View style={styles.handle} />

                  <FlatList
                    data={options}
                    keyExtractor={(item, i) => `${item.value ?? 'null'}_${i}`}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item, index }) => {
                      const isSelected = item.value === value;
                      const isLast     = index === options.length - 1;
                      return (
                        <TouchableOpacity
                          style={[styles.option, !isLast && styles.optionBorder, isSelected && styles.optionSelected]}
                          onPress={() => { onChange(item.value); setOpen(false); }}
                          activeOpacity={0.75}
                        >
                          {isSelected && (
                            <Ionicons name="checkmark" size={16} color={Colors.brandBlue} style={styles.optionCheck} />
                          )}
                          <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                            {item.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  /* Trigger */
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8,
    backgroundColor: '#FFFFFF', borderRadius: 10,
    borderWidth: 1.5, borderColor: '#DDE2E6',
    paddingHorizontal: 14, paddingVertical: 15,
  },
  triggerText:        { flex: 1, fontSize: scale(15), color: TEXT, marginRight: 8 },
  triggerPlaceholder: { color: '#8fa4b4' },

  /* Overlay semi-transparent */
  overlay: {
    flex: 1, backgroundColor: 'rgba(10,22,40,0.45)',
    justifyContent: 'flex-end',
  },

  /* Feuille bottom sheet */
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 20,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderTopColor: '#DDE2E6', borderLeftColor: '#DDE2E6', borderRightColor: '#DDE2E6',
    paddingBottom: 32, maxHeight: 420,
  },

  handle: {
    alignSelf: 'center', marginTop: 12, marginBottom: 8,
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#DDE2E6',
  },

  /* Options */
  option: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 15, paddingHorizontal: 20,
  },
  optionBorder: { borderBottomWidth: 1, borderBottomColor: '#DDE2E6' },
  optionSelected: { backgroundColor: Colors.infoBg },
  optionCheck: { marginRight: 10 },
  optionText:         { fontSize: scale(15), color: TEXT2, flex: 1 },
  optionTextSelected: { color: Colors.brandBlue, fontWeight: '700' },
});
