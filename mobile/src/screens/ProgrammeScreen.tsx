/**
 * Écran programme : liste des étapes d'une tournée avec navigation GPS.
 *
 * Cet écran affiche les étapes (Points de Livraison à visiter) d'un
 * programme, avec leur statut (À visiter / Visitée / Échec) et les
 * actions disponibles (Saisir une opération, Signaler un échec, Naviguer
 * dans Google Maps). Trois modes de tri : Circuit (ordre optimisé),
 * A–Z (alphabétique), À faire (étapes restantes en premier).
 *
 * Intégrer react-native-maps nécessite un build natif incompatible avec
 * Expo Go. L'ouverture de Google Maps via Linking est plus fiable (GPS
 * natif, offline maps) et ne nécessite aucune dépendance supplémentaire.
 * Voir CLAUDE.md §5 : décision architecture ARRÊTÉE.
 *
 * WHY (tri "Circuit" = ordre COALESCE(ordre_optimise, ordre_prevu)) :
 * L'heuristique du plus proche voisin calcule un ordre_optimise qui remplace
 * l'ordre_prevu quand disponible. Le livreur reste libre de dévier du circuit.
 *
 * useMemo ne retrie que quand etapes ou triMode change, évitant un recalcul
 * inutile à chaque render sur Android milieu de gamme (10–20 étapes).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  getEtapesDuProgramme,
  getProgrammeById,
  EtapeAvecPlv,
} from '../db/repositories/programmeRepository';
import { Programme } from '../types/models';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';
import { useLayout } from '../hooks/useLayout';
import ProgrammeHeader from '../components/programme/ProgrammeHeader';
import EtapeCard from '../components/programme/EtapeCard';
import FABAnomalies from '../components/programme/FABAnomalies';
import { TriMode } from '../components/programme/TriButtons';
import { NEO, TEXT3 } from '../components/programme/progStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'Programme'>;

export default function ProgrammeScreen({ route, navigation }: Props): React.ReactElement {
  const { programmeId } = route.params;
  const [programme, setProgramme]     = useState<Programme | null>(null);
  const [progression, setProgression] = useState({ visitees: 0, echec: 0, total: 0 });
  const [etapes, setEtapes]   = useState<EtapeAvecPlv[]>([]);
  const [loading, setLoading] = useState(true);
  const [triMode, setTriMode] = useState<TriMode>('optimise');
  const { numColumns } = useLayout();

  const etapesTri = useMemo((): EtapeAvecPlv[] => {
    if (triMode === 'alpha') return [...etapes].sort((a, b) => a.plv_libelle.localeCompare(b.plv_libelle, 'fr'));
    if (triMode === 'a_visiter') {
      const ordre = { A_VISITER: 0, VISITEE: 1, ECHEC: 2 } as Record<string, number>;
      return [...etapes].sort((a, b) => (ordre[a.statut_visite] ?? 1) - (ordre[b.statut_visite] ?? 1));
    }
    return etapes;
  }, [etapes, triMode]);

  async function chargerDonnees(): Promise<void> {
    const p = await getProgrammeById(programmeId);
    const e = await getEtapesDuProgramme(programmeId);
    setProgramme(p);
    setEtapes(e);
    setProgression({
      total:    e.length,
      visitees: e.filter((x) => x.statut_visite === 'VISITEE').length,
      echec:    e.filter((x) => x.statut_visite === 'ECHEC').length,
    });
  }

  useEffect(() => {
    (async () => { await chargerDonnees(); setLoading(false); })();
  }, [programmeId]);

  const renderEtape = useCallback(({ item }: { item: EtapeAvecPlv }): React.ReactElement => (
    <EtapeCard
      etape={item}
      programmeCloture={programme?.statut === 'CLOTURE'}
      onNavigateDetail={(etapeId, etapeUuid) => navigation.navigate('EtapeDetail', { etapeId, etapeUuid })}
      onNavigateSaisie={(etapeId) => navigation.navigate('SaisieOperation', { etapeId })}
    />
  ), [navigation, programme]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.brandBlue} /></View>;
  }

  const listHeader = programme ? (
    <ProgrammeHeader
      programme={programme}
      progression={progression}
      triMode={triMode}
      onTriModeChange={setTriMode}
      onNavigateAnomalies={() => navigation.navigate('MesAnomalies', { programmeUuid: programme.uuid, programmeNumero: programme.numero_x3 })}
      onNavigateCloture={() => navigation.navigate('Cloture', { programmeId: programme.id })}
    />
  ) : null;

  return (
    <View style={styles.root}>
      <FlatList
        key={numColumns}
        data={etapesTri}
        keyExtractor={(item) => item.uuid}
        renderItem={renderEtape}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>Aucune étape.</Text>
          </View>
        }
        ListFooterComponent={<View style={{ height: 100 }} />}
      />

      <FABAnomalies
        visible={!!programme && programme.statut !== 'CLOTURE'}
        onPress={() => programme && navigation.navigate('Anomalie', { programmeUuid: programme.uuid, programmeId: programme.id })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: NEO },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NEO },
  list:      { paddingHorizontal: 12, paddingBottom: 12 },
  emptyWrap: { padding: 40, alignItems: 'center' },
  emptyText: { color: TEXT3, textAlign: 'center', fontSize: 14 },
});
