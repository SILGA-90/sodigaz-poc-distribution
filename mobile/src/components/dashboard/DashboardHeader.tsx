import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { UtilisateurInfo } from '../../types/auth';
import { Colors } from '../../theme';
import { NAVY } from './dashStyles';

interface Props {
  user:          UtilisateurInfo | null;
  syncDotColor:  string;
  syncLabel:     string;
}

export default function DashboardHeader({ user, syncDotColor, syncLabel }: Props): React.ReactElement {
  const initiales = user
    ? `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase()
    : '?';
  const nomComplet = user ? `${user.first_name} ${user.last_name}` : ':';

  return (
    <View style={styles.header}>
      <View style={styles.hBubble1} pointerEvents="none" />
      <View style={styles.hBubble2} pointerEvents="none" />

      <View style={styles.headerTop}>
        <Image source={require('../../../assets/logo.png')} style={styles.headerLogo} resizeMode="contain" />
        <View style={styles.syncPill}>
          <View style={[styles.syncDot, { backgroundColor: syncDotColor }]} />
          <Text style={styles.syncPillText}>{syncLabel}</Text>
        </View>
      </View>

      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initiales}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userHello}>Bonjour,</Text>
          <Text style={styles.userName} numberOfLines={1}>{nomComplet}</Text>
          <Text style={styles.userCode}>{user?.code_livreur ?? ''}</Text>
        </View>
        <Image source={require('../../../assets/logo_name.png')} style={styles.brandLogo} resizeMode="contain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header:   { backgroundColor: NAVY, paddingTop: 48, paddingBottom: 20, paddingHorizontal: 16, overflow: 'hidden' },
  hBubble1: { position: 'absolute', borderRadius: 999, width: 280, height: 280, top: -80,  right: -80,  backgroundColor: 'rgba(7,155,217,0.1)' },
  hBubble2: { position: 'absolute', borderRadius: 999, width: 140, height: 140, bottom: -30, left: -40, backgroundColor: 'rgba(238,114,2,0.07)' },

  headerTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerLogo:   { width: 40, height: 40 },
  syncPill:     { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  syncDot:      { width: 8, height: 8, borderRadius: 4 },
  syncPillText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },

  userCard:   { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  avatar:     { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.brandOrange, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  userInfo:   { flex: 1 },
  userHello:  { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  userName:   { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 1 },
  userCode:   { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  brandLogo:  { width: 56, height: 34, opacity: 0.5 },
});
