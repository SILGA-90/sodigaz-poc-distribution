/**
 * Carte d'une étape de programme.
 * Gère la logique d'affichage (visite/échec/disabled) et la navigation
 * vers le détail ou la saisie. L'itinéraire Google Maps est ouvert via
 * Linking (deep-link universel, voir CLAUDE.md §5 : carte embarquée non implémentée).
 */
import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { EtapeAvecPlv } from '../../db/repositories/programmeRepository';
import { Colors } from '../../theme';
import { NEO, NEO_SHD, NEO_IN, TEXT } from './progStyles';
import NeoDialog from '../NeoDialog';

interface Props {
  etape:              EtapeAvecPlv;
  programmeCloture:   boolean;
  onNavigateDetail:   (etapeId: number, etapeUuid: string) => void;
  onNavigateSaisie:   (etapeId: number) => void;
}

export default function EtapeCard({ etape, programmeCloture, onNavigateDetail, onNavigateSaisie }: Props): React.ReactElement {
  const visite   = etape.statut_visite === 'VISITEE';
  const echec    = etape.statut_visite === 'ECHEC';
  const disabled = echec || (programmeCloture && !visite);

  const [showNavError, setShowNavError]       = useState(false);
  const [showDetailAlert, setShowDetailAlert] = useState(false);

  const accentColor = visite ? Colors.success : echec ? Colors.danger : Colors.brandOrange;
  const badgeBg     = visite ? Colors.successBg : echec ? Colors.dangerBg : Colors.warningBg;
  const badgeText   = visite ? Colors.success   : echec ? Colors.danger   : Colors.warning;
  const badgeLabel  = visite ? 'Visitée' : echec ? 'Échec' : 'À visiter';

  function ouvrirItineraire(lat: number, lon: number): void {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    Linking.openURL(url).catch(() => setShowNavError(true));
  }

  function handlePress(): void {
    if (visite) {
      if (etape.op_sync_status === null) {
        setShowDetailAlert(true);
        return;
      }
      onNavigateDetail(etape.id, etape.uuid);
    } else if (!disabled) {
      onNavigateSaisie(etape.id);
    }
  }

  return (
    <View style={[styles.outer, disabled && styles.disabled]}>
      <View style={styles.shadowLight}>
        <TouchableOpacity style={styles.content} onPress={handlePress} activeOpacity={disabled ? 1 : 0.8}>
          <View style={[styles.accent, { backgroundColor: accentColor }]} />
          <View style={styles.body}>
            <View style={styles.main}>
              <View style={[styles.ordreCircle, { backgroundColor: accentColor }]}>
                <Text style={styles.ordreText}>{etape.ordre_prevu}</Text>
              </View>
              <View style={styles.info}>
                {etape.plv_code ? (
                  <View style={styles.plvCodeChip}>
                    <Text style={styles.plvCodeText}>{etape.plv_code}</Text>
                  </View>
                ) : null}
                <Text style={styles.clientName} numberOfLines={1}>{etape.client_raison_sociale}</Text>
              </View>
              <View style={styles.right}>
                <View style={[styles.statutBadge, { backgroundColor: badgeBg }]}>
                  <View style={[styles.statutDot, { backgroundColor: accentColor }]} />
                  <Text style={[styles.statutText, { color: badgeText }]}>{badgeLabel}</Text>
                </View>
                {visite && etape.op_sync_status !== null && (
                  <View style={[styles.syncIndicator,
                    etape.op_sync_status === 'SYNCED' ? styles.syncGreen : styles.syncOrange]} />
                )}
              </View>
            </View>
            {/* Itinéraire : inset */}
            <TouchableOpacity
              style={styles.itineraireRow}
              onPress={(e) => { e.stopPropagation(); ouvrirItineraire(etape.plv_latitude, etape.plv_longitude); }}
              activeOpacity={0.65}
            >
              <Text style={styles.itineraireTxt}>Ouvrir l'itinéraire  ›</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
      <NeoDialog
        visible={showDetailAlert}
        icon="cloud-offline-outline" iconColor={Colors.brandBlue}
        title="Détail non disponible"
        message="Cette opération a été enregistrée sur un autre appareil et n'est pas accessible hors ligne."
        singleButton confirmLabel="OK"
        onConfirm={() => setShowDetailAlert(false)}
        onCancel={() => setShowDetailAlert(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginBottom: 12, borderRadius: 14, backgroundColor: NEO,
    shadowColor: NEO_SHD, shadowOffset: { width: 6, height: 6 }, shadowOpacity: 1, shadowRadius: 7, elevation: 10,
  },
  disabled: { opacity: 0.45 },
  shadowLight: {
    borderRadius: 14, backgroundColor: NEO,
    shadowColor: '#ffffff', shadowOffset: { width: -6, height: -6 }, shadowOpacity: 1, shadowRadius: 7,
  },
  content: {
    flexDirection: 'row', borderRadius: 14, backgroundColor: NEO, overflow: 'hidden',
    borderTopWidth: 1, borderLeftWidth: 1, borderBottomWidth: 1, borderRightWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.85)', borderLeftColor: 'rgba(255,255,255,0.85)',
    borderBottomColor: 'rgba(74,104,128,0.35)', borderRightColor: 'rgba(74,104,128,0.35)',
  },
  accent: { width: 5 },
  body:   { flex: 1 },
  main:   { flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 },

  ordreCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  ordreText:   { color: '#fff', fontWeight: '800', fontSize: 15 },

  info:        { flex: 1, marginRight: 8 },
  plvCodeChip: { alignSelf: 'flex-start', backgroundColor: Colors.primaryLight, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: 'rgba(7,155,217,0.3)', marginBottom: 3 },
  plvCodeText: { fontSize: 10, fontWeight: '800', color: Colors.brandBlue },
  clientName:  { fontSize: 14, fontWeight: '700', color: TEXT },

  right:        { alignItems: 'flex-end', gap: 6 },
  statutBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutDot:    { width: 6, height: 6, borderRadius: 3 },
  statutText:   { fontSize: 11, fontWeight: '700' },
  syncIndicator:{ width: 8, height: 8, borderRadius: 4 },
  syncGreen:    { backgroundColor: Colors.syncGreen },
  syncOrange:   { backgroundColor: Colors.syncPending },

  itineraireRow: {
    backgroundColor: NEO_IN, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'flex-end',
    borderTopWidth: 1, borderTopColor: 'rgba(74,104,128,0.25)',
  },
  itineraireTxt: { fontSize: 12, fontWeight: '700', color: Colors.brandBlue },
});
