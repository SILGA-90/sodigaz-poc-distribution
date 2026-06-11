// Mock minimal d'expo-sqlite pour Jest (expo-asset non installé en dev).
// Seules les fonctions utilisées par database.ts sont déclarées.
module.exports = {
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync:   jest.fn(),
    runAsync:    jest.fn(),
    getAllAsync:  jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
  }),
};
