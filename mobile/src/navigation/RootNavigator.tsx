/**
 * Stack de navigation racine de l'application mobile.
 *
 * Ce composant gère le routage de premier niveau. Au démarrage, il
 * vérifie si un access token est présent en SecureStore pour choisir
 * entre l'écran de connexion (Login) et le tableau de bord (Dashboard).
 * Toutes les routes de l'application sont déclarées ici.
 *
 * isAuthenticated() lit le
 * SecureStore, qui est une API asynchrone sur iOS/Android. On affiche
 * un spinner bleu Sodigaz pendant la vérification pour éviter un flash
 * de l'écran de connexion si l'utilisateur est déjà connecté.
 *
 * Au premier lancement après la
 * mise à jour qui déplace les photos vers documentDirectory, des photos
 * peuvent encore pointer vers le cache Android (chemin getCacheDir/).
 * La réparation est lancée en tâche de fond pour ne pas bloquer la
 * navigation. Une photo non réparée avant l'upload sera marquée
 * FILE_LOST, pas perdue silencieusement.
 *
 * Les écrans gèrent leur propre entête
 * aux couleurs SODIGAZ. L'entête React Navigation par défaut est blanc
 * Bootstrap : on le désactive à la racine pour éviter de le surcharger
 * écran par écran.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import DebugScreen from '../screens/DebugScreen';
import ProgrammeScreen from '../screens/ProgrammeScreen';
import SaisieOperationScreen from '../screens/SaisieOperationScreen';
import AnomalieScreen from '../screens/AnomalieScreen';
import ClotureScreen from '../screens/ClotureScreen';
import EtapeDetailScreen from '../screens/EtapeDetailScreen';
import MesAnomaliesScreen from '../screens/MesAnomaliesScreen';
import HistoriqueScreen from '../screens/HistoriqueScreen';
import { isAuthenticated } from '../api/authService';
import { repairCachePhotoUris } from '../db/repositories/photoRepository';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../theme';
import { navigationRef } from './navigationRef';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator(): React.ReactElement {
  const [initialRoute, setInitialRoute] = useState<'Login' | 'Dashboard' | null>(null);

  useEffect(() => {
    isAuthenticated().then((auth) => {
      setInitialRoute(auth ? 'Dashboard' : 'Login');
      // Réparation des URIs de cache existantes : fire-and-forget, non bloquant.
      if (auth) repairCachePhotoUris().catch(() => {});
    });
  }, []);

  if (initialRoute === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={Colors.brandBlue} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Programme" component={ProgrammeScreen} options={{ headerShown: true, title: "Programme" }} />
        <Stack.Screen name="SaisieOperation" component={SaisieOperationScreen} options={{ headerShown: true, title: "Saisie operation" }} />
        <Stack.Screen name="Anomalie" component={AnomalieScreen} options={{ headerShown: true, title: "Anomalie" }} />
        <Stack.Screen name="Cloture" component={ClotureScreen} options={{ headerShown: true, title: "Cloture" }} />
        <Stack.Screen name="Debug" component={DebugScreen} options={{ headerShown: true, title: "Debug BDD" }} />
        <Stack.Screen name="EtapeDetail" component={EtapeDetailScreen} options={{ headerShown: true, title: "Detail etape" }} />
        <Stack.Screen name="MesAnomalies" component={MesAnomaliesScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Historique" component={HistoriqueScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
