/**
 * En-tête navy de l'écran de saisie : statut GPS, bouton itinéraire,
 * type d'opération, nom du PLV et raison sociale du client.
 */
import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, scale } from '../../theme';
import { EtapeInfo } from '../../db/repositories/saisieRepository';
import { NAVY, TEXT2 } from './neoStyles';
import NeoDialog from '../NeoDialog';

export type GpsStatus = 'acquisition' | 'fiable' | 'degradee' | 'absente';

interface Props {
  etapeInfo: EtapeInfo;
  gpsStatus: GpsStatus;
}

function gpsStyle(status: GpsStatus): { color: string; bg: string; label: string } {
  switch (status) {
    case 'fiable':      return { color: Colors.success,  bg: Colors.successBg,  label: 'GPS fiable' };
    case 'degradee':    return { color: Colors.warning,  bg: Colors.warningBg,  label: 'GPS imprécis' };
    case 'absente':     return { color: Colors.danger,   bg: Colors.dangerBg,   label: 'GPS absent' };
    default:            return { color: TEXT2,            bg: '#d4dde6',          label: 'GPS...' };
  }
}

export default function SaisieHeader({ etapeInfo, gpsStatus }: Props): React.ReactElement {
  const gps        = gpsStyle(gpsStatus);
  const isCollecte = etapeInfo.type_programme === 'COLLECTE';
  const [showNavError, setShowNavError] = useState(false);

  function ouvrirItineraire(): void {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${etapeInfo.plv_latitude},${etapeInfo.plv_longitude}`;
    Linking.openURL(url).catch(() => setShowNavError(true));
  }

  return (
    <View style={styles.header}>
      <View style={styles.bubble1} pointerEvents="none" />
      <View style={styles.bubble2} pointerEvents="none" />
      <View style={styles.content}>
        <View style={styles.topBar}>
          <View style={[styles.gpsPill, { backgroundColor: gps.bg, borderColor: gps.color + '40' }]}>
            <View style={[styles.gpsDot, { backgroundColor: gps.color }]} />
            <Text style={[styles.gpsPillText, { color: gps.color }]}>{gps.label}</Text>
          </View>
          <TouchableOpacity style={styles.itineraireBtn} onPress={ouvrirItineraire} activeOpacity={0.8}>
            <Text style={styles.itineraireText}>Itinéraire ›</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.typeChip, isCollecte ? styles.typeChipC : styles.typeChipR]}>
          <Text style={styles.typeChipText}>{isCollecte ? 'Collecte' : 'Restitution'}</Text>
        </View>
        {etapeInfo.plv_code ? (
          <View style={styles.plvCodeChip}>
            <Text style={styles.plvCodeText}>{etapeInfo.plv_code}</Text>
          </View>
        ) : null}
        <Text style={styles.clientName}>{etapeInfo.client_raison_sociale}</Text>
      </View>
      <NeoDialog
        visible={showNavError}
        icon="navigate-outline" iconColor={Colors.danger}
        title="Navigation impossible"
        message="Impossible d'ouvrir l'application de navigation. Vérifie que Google Maps est installé."
        singleButton confirmLabel="OK"
        onConfirm={() => setShowNavError(false)}
        onCancel={() => setShowNavError(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header:  { backgroundColor: NAVY, overflow: 'hidden' },
  bubble1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -55, right: -40, backgroundColor: 'rgba(7,155,217,0.1)' },
  bubble2: { position: 'absolute', width: 110, height: 110, borderRadius: 55,  top: 35, right: 100, backgroundColor: 'rgba(7,155,217,0.07)' },
  content: { padding: 16, paddingBottom: 22 },
  topBar:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

  gpsPill:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  gpsDot:      { width: 7, height: 7, borderRadius: 4 },
  gpsPillText: { fontSize: scale(12), fontWeight: '700' },

  itineraireBtn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16,
    backgroundColor: Colors.brandBlue,
  },
  itineraireText: { color: '#fff', fontWeight: '700', fontSize: scale(12) },

  typeChip:     { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginBottom: 8, borderWidth: 1 },
  typeChipC:    { backgroundColor: 'rgba(7,155,217,0.2)',  borderColor: 'rgba(7,155,217,0.4)' },
  typeChipR:    { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.4)' },
  typeChipText: { fontSize: scale(11), fontWeight: '700', color: '#e2e8f0' },
  plvCodeChip:  { alignSelf: 'flex-start', backgroundColor: 'rgba(7,155,217,0.25)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(7,155,217,0.5)', marginBottom: 5 },
  plvCodeText:  { fontSize: scale(11), fontWeight: '800', color: '#7dd3fa' },
  clientName:   { fontSize: scale(20), fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
});
