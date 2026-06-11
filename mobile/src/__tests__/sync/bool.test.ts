/**
 * Tests unitaires pour bool() — conversion JSON → entier SQLite.
 *
 * SQLite ne possède pas de type BOOLEAN natif : les colonnes booléennes
 * sont stockées en INTEGER (0/1). bool() effectue cette conversion sur
 * les données reçues depuis l'API avant insertion locale.
 */
import { bool } from '../../sync/pull';

describe('bool()', () => {
  it('convertit true en 1', () => {
    expect(bool(true)).toBe(1);
  });

  it('convertit false en 0', () => {
    expect(bool(false)).toBe(0);
  });

  it('convertit 1 (entier JSON) en 1', () => {
    expect(bool(1)).toBe(1);
  });

  it('convertit 0 (entier JSON) en 0', () => {
    expect(bool(0)).toBe(0);
  });

  it('convertit null en 0', () => {
    expect(bool(null)).toBe(0);
  });

  it('convertit undefined en 0', () => {
    expect(bool(undefined)).toBe(0);
  });

  it('convertit une chaîne non vide en 1', () => {
    expect(bool('oui')).toBe(1);
  });

  it('convertit une chaîne vide en 0', () => {
    expect(bool('')).toBe(0);
  });
});
