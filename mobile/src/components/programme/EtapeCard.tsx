/**
 * Carte d'une étape de programme.
 * Gère la logique d'affichage (visite/échec/disabled) et la navigation
 * vers le détail ou la saisie. L'itinéraire Google Maps est ouvert via
 * Linking (deep-link universel, voir CLAUDE.md §5 : carte embarquée non implémentée).
 */
import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { EtapeAvecPlv } from '../../db/repositories/programmeRepository';
import { Colors, scale } from '../../theme';
import { NEO_IN, SURFACE, TEXT } from './progStyles';
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
    <View style={[styles.card, disabled && styles.disabled]}>
      <TouchableOpacity style={styles.content} onPress={handlePress} activeOpacity={disabled ? 1 : 0.82}>
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
                <View style={[styles.statutBadge, {
                  backgroundColor: etape.op_sync_status === 'SYNCED' ? Colors.successBg : Colors.warningBg,
                }]}>
                  <View style={[styles.statutDot, {
                    backgroundColor: etape.op_sync_status === 'SYNCED' ? Colors.syncGreen : Colors.syncPending,
                  }]} />
                  <Text style={[styles.statutText, {
                    color: etape.op_sync_status === 'SYNCED' ? Colors.success : Colors.warning,
                  }]}>
                    {etape.op_sync_status === 'SYNCED' ? 'Synchronisé' : 'En attente'}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={styles.itineraireRow}
            onPress={(e) => { e.stopPropagation(); ouvrirItineraire(etape.plv_latitude, etape.plv_longitude); }}
            activeOpacity={0.65}
          >
            <Text style={styles.itineraireTxt}>Ouvrir l'itinéraire  ›</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

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
  card: {
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: '#DDE2E6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    overflow: 'hidden',
  },
  disabled: { opacity: 0.45 },
  content:  { flexDirection: 'row' },
  accent:   { width: 5 },
  body:     { flex: 1 },
  main:     { flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 },

  ordreCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  ordreText:   { color: '#fff', fontWeight: '800', fontSize: scale(15) },

  info:        { flex: 1, marginRight: 8 },
  plvCodeChip: { alignSelf: 'flex-start', backgroundColor: Colors.primaryLight, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: 'rgba(7,155,217,0.3)', marginBottom: 3 },
  plvCodeText: { fontSize: scale(10), fontWeight: '800', color: Colors.brandBlue },
  clientName:  { fontSize: scale(14), fontWeight: '700', color: TEXT },

  right:        { alignItems: 'flex-end', gap: 6 },
  statutBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutDot:    { width: 6, height: 6, borderRadius: 3 },
  statutText:   { fontSize: scale(11), fontWeight: '700' },
  itineraireRow: {
    backgroundColor: NEO_IN,
    paddingVertical: 10, paddingHorizontal: 14, alignItems: 'flex-end',
    borderTopWidth: 1, borderTopColor: '#DDE2E6',
  },
  itineraireTxt: { fontSize: scale(12), fontWeight: '700', color: Colors.brandBlue },
});
