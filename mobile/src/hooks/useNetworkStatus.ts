/**
 * Hook React Native : état du réseau en temps réel.
 *
 * Ce hook s'abonne aux changements de connectivité réseau via
 * NetInfo et expose :
 *          - isConnected      : état actuel (true / false / null au démarrage)
 *          - justReconnected  : true lors de la transition offline -> online
 *          - clearReconnected : réinitialise justReconnected après traitement
 *
 * isConnected ne change que
 * quand l'état change. justReconnected détecte précisément la transition
 * offline -> online pour déclencher une synchronisation automatique dès
 * que le réseau revient : sans déclencher de sync à chaque render.
 * L'appelant (ProgrammeScreen, SaisieOperationScreen) appelle syncAll()
 * sur justReconnected, puis clearReconnected() pour remettre à zéro.
 *
 * NetInfo est asynchrone : l'état initial
 * est inconnu jusqu'au premier événement. null signifie "état non encore
 * déterminé" et est distinct de false (hors ligne confirmé). L'UI peut
 * traiter null comme "en attente" et ne pas afficher de bandeau d'erreur
 * prématuré.
 *
 * Bibliothèque standard React Native
 * pour la détection de connectivité, compatible Expo Go.
 */
import { useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

interface NetworkStatus {
  isConnected:      boolean | null;
  justReconnected:  boolean;
  clearReconnected: () => void;
}

export function useNetworkStatus(): NetworkStatus {
  const [isConnected,     setIsConnected]     = useState<boolean | null>(null);
  const [justReconnected, setJustReconnected] = useState(false);
  const prevConnected = useRef<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? false;
      // Détecter la transition offline -> online
      if (prevConnected.current === false && connected === true) {
        setJustReconnected(true);
      }
      prevConnected.current = connected;
      setIsConnected(connected);
    });
    return unsubscribe;
  }, []);

  function clearReconnected() {
    setJustReconnected(false);
  }

  return { isConnected, justReconnected, clearReconnected };
}
