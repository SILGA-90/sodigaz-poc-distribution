import React, { useState } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';
import { Colors, scale } from '../../theme';
import { TEXT } from './neoStyles';

interface Props {
  value:          string;
  onChangeText:   (v: string) => void;
  placeholder?:   string;
  keyboardType?:  TextInputProps['keyboardType'];
}

export default function FieldInput({ value, onChangeText, placeholder, keyboardType }: Props): React.ReactElement {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[styles.input, focused && styles.inputFocused]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#8fa4b4"
      keyboardType={keyboardType}
      autoCorrect={false}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5, borderColor: '#DDE2E6',
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: scale(15), color: TEXT,
  },
  inputFocused: {
    borderColor: Colors.brandBlue,
    backgroundColor: Colors.primaryLight,
  },
});
