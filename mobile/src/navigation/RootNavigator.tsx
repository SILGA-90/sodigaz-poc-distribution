/**
 * Stack de navigation racine.
 * Determine au demarrage si l'utilisateur est deja connecte.
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
import { isAuthenticated } from '../api/authService';
import { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator(): React.ReactElement {
  const [initialRoute, setInitialRoute] = useState<'Login' | 'Dashboard' | null>(null);

  useEffect(() => {
    isAuthenticated().then((auth) => {
      setInitialRoute(auth ? 'Dashboard' : 'Login');
    });
  }, []);

  if (initialRoute === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  return (
    <NavigationContainer>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
