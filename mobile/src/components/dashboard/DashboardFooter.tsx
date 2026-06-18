import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import { NEO_IN, TEXT3 } from './dashStyles';

interface Props {
  devUnlocked:      boolean;
  onLogout:         () => void;
  onDevTap:         () => void;
  onNavigateDebug:  () => void;
}

export default function DashboardFooter({ devUnlocked, onLogout, onDevTap, onNavigateDebug }: Props): React.ReactElement {
  return (
    <View style={styles.footer}>
      <View style={styles.logoutOuter}>
        <TouchableOpacity style={styles.logoutInner} onPress={onLogout} activeOpacity={0.82}>
          <Text style={styles.logoutText}>Déconnexion</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.devZone}>
        <TouchableOpacity onPress={onDevTap} hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}>
          <Text style={styles.versionText}>v1.0 POC</Text>
        </TouchableOpacity>
        {devUnlocked && (
          <TouchableOpacity style={styles.debugLink} onPress={onNavigateDebug}>
            <Text style={styles.debugLinkText}>Debug BDD</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 16, paddingBottom: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: NEO_IN,
  },
  logoutOuter: {
    borderRadius: 12, backgroundColor: Colors.dangerBg,
    shadowColor: '#991111', shadowOffset: { width: 5, height: 5 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
  },
  logoutInner: {
    borderRadius: 12, backgroundColor: Colors.dangerBg,
    paddingVertical: 13, alignItems: 'center',
    shadowColor: '#fff0f0', shadowOffset: { width: -3, height: -3 }, shadowOpacity: 0.7, shadowRadius: 6,
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: '#fdd', borderLeftColor: '#fdd',
    borderBottomColor: '#e88', borderRightColor: '#e88',
  },
  logoutText:    { color: Colors.danger, fontWeight: '700', fontSize: scale(14) },
  devZone:       { alignItems: 'center', gap: 4, paddingVertical: 8, flexDirection: 'row', justifyContent: 'center' },
  versionText:   { color: TEXT3, fontSize: scale(11) },
  debugLink:     { paddingVertical: 4, paddingHorizontal: 12 },
  debugLinkText: { color: Colors.brandBlue, fontSize: scale(12), fontWeight: '600' },
});
