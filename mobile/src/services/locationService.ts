/**
 * Service de localisation GPS a valeur probante.
 *
 * Principe : on acquiert une position FRAICHE et active au moment ou on en a
 * besoin (a l'enregistrement de l'operation), en haute precision, avec timeout.
 * On renvoie une position QUALIFIEE :
 *   - fiable   : acquise, recente, precision <= SEUIL_FIABLE metres
 *   - degradee : acquise mais imprecise (precision > seuil) ou via cache recent
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

const SEUIL_FIABLE_METRES = 50;
const TIMEOUT_MS = 15000;

const POSITION_ABSENTE: PositionQualifiee = {
  qualite: 'absente',
  latitude: null,
  longitude: null,
  precision: null,
  horodatage: null,
};

/**
 * Acquisition fraiche et active de la position, qualifiee.
 * A appeler au moment de l'enregistrement (valeur probante).
 */
export async function acquerirPositionProbante(): Promise<PositionQualifiee> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    console.log('[GPS] Services desactives.');
    return POSITION_ABSENTE;
  }

  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    console.log('[GPS] Permission refusee.');
    return POSITION_ABSENTE;
  }

  // Acquisition fraiche, haute precision, avec timeout via Promise.race.
  try {
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);

    if (loc) {
      const precision = loc.coords.accuracy ?? null;
      const qualite: QualitePosition =
        precision != null && precision <= SEUIL_FIABLE_METRES ? 'fiable' : 'degradee';
      console.log('[GPS] Position fraiche :', loc.coords.latitude, loc.coords.longitude, 'precision', precision, '->', qualite);
      return {
        qualite,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        precision,
        horodatage: new Date(loc.timestamp).toISOString(),
      };
    }
    console.log('[GPS] Timeout acquisition fraiche, repli sur derniere position connue.');
  } catch (e) {
    console.log('[GPS] Erreur acquisition fraiche :', e);
  }

  // Repli : derniere position connue tres recente (< 30 s) = degradee.
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 1000 });
    if (last) {
      console.log('[GPS] Repli derniere position connue :', last.coords.latitude, last.coords.longitude);
      return {
        qualite: 'degradee',
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
        precision: last.coords.accuracy ?? null,
        horodatage: new Date(last.timestamp).toISOString(),
      };
    }
  } catch (e) {
    console.log('[GPS] Repli echoue :', e);
  }

  return POSITION_ABSENTE;
}
