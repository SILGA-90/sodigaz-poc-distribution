import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import { TEXT3 } from './dashStyles';

interface Props {
  devUnlocked:      boolean;
  onLogout:         () => void;
  onDevTap:         () => void;
  onNavigateDebug:  () => void;
}

export default function DashboardFooter({ devUnlocked, onLogout, onDevTap, onNavigateDebug }: Props): React.ReactElement {
  return (
    <View style={styles.footer}>
      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} activeOpacity={0.82}>
        <Text style={styles.logoutText}>Déconnexion</Text>
      </TouchableOpacity>
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
    borderTopWidth: 1, borderTopColor: '#DDE2E6',
  },
  logoutBtn: {
    borderRadius: 12,
    backgroundColor: Colors.dangerBg,
    borderWidth: 1, borderColor: Colors.dangerBorder,
    paddingVertical: 13,
    alignItems: 'center',
  },
  logoutText:    { color: Colors.danger, fontWeight: '700', fontSize: scale(14) },
  devZone:       { alignItems: 'center', gap: 4, paddingVertical: 8, flexDirection: 'row', justifyContent: 'center' },
  versionText:   { color: TEXT3, fontSize: scale(11) },
  debugLink:     { paddingVertical: 4, paddingHorizontal: 12 },
  debugLinkText: { color: Colors.brandBlue, fontSize: scale(12), fontWeight: '600' },
});
