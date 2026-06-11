/**
 * Logger conditionnel : actif uniquement en mode développement (__DEV__).
 *
 * En production (build Expo), __DEV__ vaut false et les appels ne
 * produisent aucune sortie. Le code appelant n'a pas besoin de tester
 * __DEV__ lui-même, ce qui évite la prolifération de conditions partout.
 */

const logger = {
  log:   (...args: unknown[]): void => { if (__DEV__) console.log(...args); },
  warn:  (...args: unknown[]): void => { if (__DEV__) console.warn(...args); },
  // error est toujours actif : les erreurs critiques doivent apparaître même en production
  // (adb logcat, React Native LogBox, ou futur outil de crash reporting).
  error: (...args: unknown[]): void => { console.error(...args); },
};

export default logger;
