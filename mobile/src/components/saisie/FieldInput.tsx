import React, { useState } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';
import { Colors } from '../../theme';
import { NEO_IN, TEXT } from './neoStyles';

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
    marginTop: 8, backgroundColor: NEO_IN, borderRadius: 10,
    borderTopWidth: 1.5, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderTopColor: '#a8bac8', borderLeftColor: '#a8bac8',
    borderBottomColor: '#f4f8fb', borderRightColor: '#f4f8fb',
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: TEXT,
  },
  inputFocused: {
    borderTopColor: Colors.brandBlue, borderLeftColor: Colors.brandBlue,
    borderBottomColor: '#b0daf2', borderRightColor: '#b0daf2',
    backgroundColor: '#cce6f4',
  },
});
