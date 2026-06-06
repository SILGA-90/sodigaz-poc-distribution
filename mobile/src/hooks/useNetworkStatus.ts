import { useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

interface NetworkStatus {
  isConnected: boolean | null;
  justReconnected: boolean;
  clearReconnected: () => void;
}

/**
 * Ecoute l'etat du reseau en temps reel.
 * justReconnected passe a true lors de la transition offline -> online.
 */
export function useNetworkStatus(): NetworkStatus {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [justReconnected, setJustReconnected] = useState(false);
  const prevConnected = useRef<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? false;
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
