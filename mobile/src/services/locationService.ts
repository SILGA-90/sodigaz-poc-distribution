/**
 * Service de localisation GPS a valeur probante.
 *
 * Principe : on acquiert une position FRAICHE et active au moment ou on en a
 * besoin (a l'enregistrement de l'operation), en haute precision, avec timeout.
 * On renvoie une position QUALIFIEE :
 *   - fiable   : acquise, recente, precision <= SEUIL_FIABLE metres
 *   - degradee : acquise mais imprecise, ou via cache recent
 *   - absente  : aucune position obtenue
 *
 * On expose aussi la precision (rayon d'incertitude) et l'horodatage, qui
 * sont stockes avec l'operation pour documenter la qualite de la preuve.
 */
import * as Location from 'expo-location';

export type QualitePosition = 'fiable' | 'degradee' | 'absente';

export interface PositionQualifiee {
  qualite: QualitePosition;
  latitude: number | null;
  longitude: number | null;
  precision: number | null;   // metres
  horodatage: string | null;  // ISO 8601, instant de l'acquisition GPS
}

// 100 m : précision typique du fused location provider Android avant fix satellite.
// 75-100 m est suffisant pour prouver la présence à un PLV (valeur probante).
// Un fix satellite (5-15 m) n'est pas garanti en intérieur ou à l'ouverture.
const SEUIL_FIABLE_METRES = 100;
// 45 s : donne plus de temps au GPS satellite pour un cold fix (~30-40 s).
const TIMEOUT_MS = 45000;
// 2 min : couvre le temps de remplissage du formulaire apres une prise fraiche.
const MAX_AGE_REPLI_MS = 120 * 1000;

const POSITION_ABSENTE: PositionQualifiee = {
  qualite: 'absente',
  latitude: null,
  longitude: null,
  precision: null,
  horodatage: null,
};

function _qualifierCoords(coords: Location.LocationObjectCoords, ts: number): PositionQualifiee {
  const precision = coords.accuracy ?? null;
  const qualite: QualitePosition =
    precision != null && precision <= SEUIL_FIABLE_METRES ? 'fiable' : 'degradee';
  return {
    qualite,
    latitude: coords.latitude,
    longitude: coords.longitude,
    precision,
    horodatage: new Date(ts).toISOString(),
  };
}

/**
 * Acquisition fraiche et active de la position, qualifiee.
 *
 * Strategie :
 *  1. Essai haute precision avec timeout de 30 s.
 *  2. Si echec : repli sur la derniere position connue (max 2 min).
 *  3. Si toujours rien : POSITION_ABSENTE.
 *
 * Appeler cote ecran a l'ouverture (warm-up) ET a l'enregistrement.
 */
export async function acquerirPositionProbante(): Promise<PositionQualifiee> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    console.log('[GPS] Services desactives — verifie les parametres du telephone.');
    return POSITION_ABSENTE;
  }

  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    console.log('[GPS] Permission refusee.');
    return POSITION_ABSENTE;
  }

  // Tentative principale : position fraiche haute precision
  try {
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);

    if (loc) {
      const pos = _qualifierCoords(loc.coords, loc.timestamp);
      console.log('[GPS] Position fraiche :', pos.latitude, pos.longitude,
        '±', pos.precision, 'm ->', pos.qualite);
      return pos;
    }
    console.warn('[GPS] Timeout fraiche (30 s), repli sur derniere position connue.');
  } catch (e) {
    console.warn('[GPS] Erreur acquisition fraiche :', e);
  }

  // Repli : derniere position connue recente (max 2 min)
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_REPLI_MS });
    if (last) {
      const pos = _qualifierCoords(last.coords, last.timestamp);
      console.log('[GPS] Repli derniere position :', pos.latitude, pos.longitude,
        '±', pos.precision, 'm (age', Math.round((Date.now() - last.timestamp) / 1000), 's)');
      return { ...pos, qualite: 'degradee' };
    }
  } catch (e) {
    console.warn('[GPS] Repli echoue :', e);
  }

  console.warn('[GPS] Aucune position disponible.');
  return POSITION_ABSENTE;
}

/**
 * Verifie si une position peut etre reutilisee (moins de maxAgeMs).
 * Permet d'eviter une double acquisition si la position est recente.
 */
export function positionEstRecente(pos: PositionQualifiee, maxAgeMs = 5 * 60 * 1000): boolean {
  if (!pos.horodatage || pos.qualite === 'absente') return false;
  return Date.now() - new Date(pos.horodatage).getTime() < maxAgeMs;
}
