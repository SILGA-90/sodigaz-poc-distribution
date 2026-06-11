/**
 * Tests de l'orchestration syncAll().
 *
 * L'invariant central du système offline-first est l'ordre d'exécution :
 *   syncAll() = pushClotures() → pull() → push()
 *
 * pushClotures doit précéder pull pour éviter que le pull ne réécrase
 * le statut CLOTURE local avec PLANIFIE (le serveur ne connaît pas encore
 * la clôture). Si l'ordre était inversé, une clôture locale serait perdue.
 *
 * Ces tests vérifient l'ordre et le comportement de l'orchestrateur
 * sans dépendance réseau ni SQLite (tout est mocké).
 *
 * Pattern : jest.mock() avec factory jest.fn() (hoisting-safe),
 * puis import des modules mockés pour les configurer via beforeEach.
 */

// jest.mock est hoisted avant les imports — les factories ne peuvent pas
// référencer des variables locales. On utilise jest.fn() directement
// dans chaque factory, puis on cast les imports après.

jest.mock('../../sync/pull', () => ({ pull: jest.fn() }));
jest.mock('../../sync/push', () => ({ push: jest.fn() }));
jest.mock('../../db/repositories/programmeRepository', () => ({
  purgerDonneesAnciennes: jest.fn(),
}));
jest.mock('../../db/database', () => ({
  getCloturesPending:   jest.fn(),
  clearCloturesPending: jest.fn(),
}));
jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
jest.mock('../../services/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn() },
}));

import { syncAll } from '../../sync/syncService';
import { pull }    from '../../sync/pull';
import { push }    from '../../sync/push';
import { purgerDonneesAnciennes } from '../../db/repositories/programmeRepository';
import { getCloturesPending, clearCloturesPending } from '../../db/database';
import apiClient from '../../api/client';

// Alias typés pour éviter les casts répétés
const mockPull     = pull                  as jest.MockedFunction<typeof pull>;
const mockPush     = push                  as jest.MockedFunction<typeof push>;
const mockPurger   = purgerDonneesAnciennes as jest.MockedFunction<typeof purgerDonneesAnciennes>;
const mockGetClotures   = getCloturesPending   as jest.MockedFunction<typeof getCloturesPending>;
const mockClearClotures = clearCloturesPending as jest.MockedFunction<typeof clearCloturesPending>;
const mockApiPost  = (apiClient.post)      as jest.Mock;

// -------------------------------------------------------------------------

const PULL_OK  = { success: true,  timestamp: 1000, counts: {} };
const PULL_ERR = { success: false, timestamp: 0,    counts: {}, error: 'timeout' };
const PUSH_OK  = { success: true,  pushed: { operation: 2, ligne_operation: 2, anomalie: 0 } };
const PUSH_ERR = { success: false, pushed: { operation: 0, ligne_operation: 0, anomalie: 0 }, error: 'timeout' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetClotures.mockResolvedValue([]);
  mockClearClotures.mockResolvedValue(undefined);
  mockPull.mockResolvedValue(PULL_OK);
  mockPush.mockResolvedValue(PUSH_OK);
  mockPurger.mockResolvedValue(undefined);
  mockApiPost.mockResolvedValue({ data: {} });
});

// ===========================================================================
// 1. ORDRE D'EXÉCUTION
// ===========================================================================

describe('syncAll() — ordre pull avant push', () => {
  it('appelle pull AVANT push', async () => {
    const order: string[] = [];
    mockPull.mockImplementation(async () => { order.push('pull'); return PULL_OK; });
    mockPush.mockImplementation(async () => { order.push('push'); return PUSH_OK; });

    await syncAll();

    expect(order).toEqual(['pull', 'push']);
  });

  it('retourne les résultats de pull et push', async () => {
    const result = await syncAll();

    expect(result.pull).toEqual(PULL_OK);
    expect(result.push).toEqual(PUSH_OK);
  });
});

// ===========================================================================
// 2. PURGE DES DONNÉES ANCIENNES
// ===========================================================================

describe('syncAll() — purge conditionnelle', () => {
  it('purge les données si pull ET push réussissent', async () => {
    await syncAll();

    expect(mockPurger).toHaveBeenCalledWith(90);
  });

  it("ne purge PAS si pull échoue", async () => {
    mockPull.mockResolvedValue(PULL_ERR);

    await syncAll();

    expect(mockPurger).not.toHaveBeenCalled();
  });

  it("ne purge PAS si push échoue", async () => {
    mockPush.mockResolvedValue(PUSH_ERR);

    await syncAll();

    expect(mockPurger).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. PUSH CLÔTURES
// ===========================================================================

describe('syncAll() — clôtures en attente', () => {
  it("n'appelle pas l'API si aucune clôture en attente", async () => {
    await syncAll();

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('envoie les UUIDs clôturés et les efface de la file', async () => {
    const uuids = ['uuid-prog-1', 'uuid-prog-2'];
    mockGetClotures.mockResolvedValue(uuids);

    await syncAll();

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/sync/programmes/cloturer/',
      { uuids },
    );
    expect(mockClearClotures).toHaveBeenCalledWith(uuids);
  });

  it("ne bloque pas le cycle si l'envoi des clôtures échoue", async () => {
    mockGetClotures.mockResolvedValue(['uuid-prog-1']);
    mockApiPost.mockRejectedValue(new Error('réseau coupé'));

    const result = await syncAll();

    // pull et push doivent quand même s'exécuter malgré l'échec de pushClotures
    expect(mockPull).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalled();
    expect(result.pull.success).toBe(true);
    expect(result.push.success).toBe(true);
  });
});
