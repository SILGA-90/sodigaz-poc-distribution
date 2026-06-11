/**
 * Service de localisation GPS à valeur probante.
 *
 * Ce module fournit acquerirPositionProbante(), qui acquiert et
 * qualifie une position GPS au moment de l'enregistrement d'une
 * opération terrain. La position est retournée avec sa qualité
 * (fiable / dégradée / absente), sa précision (mètres) et son
 * horodatage : pour documenter la valeur probante de la preuve GPS.
 *
 * Sur Android, le "fused location provider"
 * retourne d'abord une position réseau (70-100 m) avant le fix satellite
 * (5-15 m). Pour le POC, on classe toute position ≤ 100 m comme "fiable"
 * : c'est suffisant pour prouver la présence à un PLV avec une incertitude
 * acceptable. Un fix satellite est préférable mais pas garanti en intérieur.
 *
 * Valeur de 100 m choisie pour couvrir la
 * précision typique du fused provider Android sans fix satellite. Ce seuil
 * est une étiquette de classification (fiable / dégradé), pas un cap
 * matériel. Voir CLAUDE.md §5.
 *
 * Un cold fix satellite prend 30-40 s. 45 s donne
 * le temps à l'OS d'acquérir un fix précis sans bloquer le livreur trop
 * longtemps. En cas de timeout, on se replie sur la dernière position connue.
 *
 * *        1. Position fraîche haute précision (tentative principale).
 * 2. Dernière position connue récente (< 2 min) si échec ou timeout.
 * 3. POSITION_ABSENTE si aucune position disponible.
 * L'opération peut être enregistrée sans GPS : la valeur probante est alors
 * réduite mais l'utilisateur en est informé.
 *
 * Le superviseur peut
 * ainsi évaluer la qualité de la preuve GPS opération par opération.
 * Un livreur honnête n'a rien à craindre d'un fix réseau (100 m) ;
 * une fraude (saisie à distance) serait détectable par l'absence de fix.
 */
import * as Location from 'expo-location';
import logger from './logger';

export type QualitePosition = 'fiable' | 'degradee' | 'absente';

export interface PositionQualifiee {
  qualite:     QualitePosition;
  latitude:    number | null;
  longitude:   number | null;
  precision:   number | null;  // rayon d'incertitude en mètres
  horodatage:  string | null;  // ISO 8601, moment de l'acquisition GPS
}

// 100 m : précision typique du fused location provider Android avant fix satellite.
// Un fix satellite (5-15 m) reste préférable mais n'est pas garanti en intérieur.
const SEUIL_FIABLE_METRES = 100;
// 45 s : laisse le temps à l'OS d'acquérir un fix satellite (cold fix ~30-40 s).
const TIMEOUT_MS = 45000;
// 2 min : durée maximale d'une position en cache utilisable comme repli.
const MAX_AGE_REPLI_MS = 120 * 1000;

const POSITION_ABSENTE: PositionQualifiee = {
  qualite:    'absente',
  latitude:   null,
  longitude:  null,
  precision:  null,
  horodatage: null,
};

function _qualifierCoords(coords: Location.LocationObjectCoords, ts: number): PositionQualifiee {
  const precision = coords.accuracy ?? null;
  const qualite: QualitePosition =
    precision != null && precision <= SEUIL_FIABLE_METRES ? 'fiable' : 'degradee';
  return {
    qualite,
    latitude:   coords.latitude,
    longitude:  coords.longitude,
    precision,
    horodatage: new Date(ts).toISOString(),
  };
}

/**
 * Acquiert et qualifie une position GPS fraîche.
 *
 * Appeler à l'ouverture de
 * l'écran permet à l'OS de démarrer le fix satellite en avance. Le second
 * appel à l'enregistrement récupère le fix (maintenant prêt) en temps réel.
 *
 * expo-location n'a pas d'option timeout
 * directe dans toutes les versions. Le race() garantit que l'acquisition
 * ne bloque pas l'UI plus de TIMEOUT_MS secondes même si le GPS ne répond
 * pas (intérieur, mode avion, matériel défaillant).
 */
export async function acquerirPositionProbante(): Promise<PositionQualifiee> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    logger.log('[GPS] Services désactivés : vérifier les paramètres du téléphone.');
    return POSITION_ABSENTE;
  }

  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    logger.log('[GPS] Permission refusée.');
    return POSITION_ABSENTE;
  }

  // Étape 1 : position fraîche haute précision
  try {
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);

    if (loc) {
      const pos = _qualifierCoords(loc.coords, loc.timestamp);
      logger.log('[GPS] Position fraîche :', pos.latitude, pos.longitude,
        '±', pos.precision, 'm ->', pos.qualite);
      return pos;
    }
    logger.warn('[GPS] Timeout fraîche (45 s), repli sur dernière position connue.');
  } catch (e) {
    logger.warn('[GPS] Erreur acquisition fraîche :', e);
  }

  // Étape 2 : dernière position connue récente (< 2 min)
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_REPLI_MS });
    if (last) {
      const pos = _qualifierCoords(last.coords, last.timestamp);
      logger.log('[GPS] Repli dernière position :', pos.latitude, pos.longitude,
        '±', pos.precision, 'm (âge', Math.round((Date.now() - last.timestamp) / 1000), 's)');
      return { ...pos, qualite: 'degradee' };
    }
  } catch (e) {
    logger.warn('[GPS] Repli échoué :', e);
  }

  // Étape 3 : aucune position disponible
  logger.warn('[GPS] Aucune position disponible.');
  return POSITION_ABSENTE;
}

/**
 * Vérifie si une position peut être réutilisée (pas trop ancienne).
 * Évite une double acquisition si la position capturée à l'ouverture
 * de l'écran est toujours récente au moment de l'enregistrement.
 */
export function positionEstRecente(pos: PositionQualifiee, maxAgeMs = 5 * 60 * 1000): boolean {
  if (!pos.horodatage || pos.qualite === 'absente') return false;
  return Date.now() - new Date(pos.horodatage).getTime() < maxAgeMs;
}
