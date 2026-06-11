/**
 * Typage TypeScript de la stack de navigation React Navigation.
 *
 * Déclare RootStackParamList, qui associe chaque nom d'écran à ses
 * paramètres de navigation. Utilisé par useNavigation<> et
 * createNativeStackNavigator<RootStackParamList> pour du typage fort.
 *
 * Sans ce type, les appels navigate('Programme', {})
 * ne sont pas vérifiés par TypeScript : un programmeId manquant ou mal
 * nommé passe à la compilation mais plante à l'exécution. Le typage
 * fort attrape ces erreurs à la compilation.
 *
 * Ces écrans n'ont pas de paramètres.
 * undefined est la convention React Navigation pour "pas de params".
 */

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Historique: undefined;
  Programme: { programmeId: number };
  SaisieOperation: { etapeId: number };
  Anomalie: { programmeUuid: string; programmeId: number };
  Cloture: { programmeId: number };
  Debug: undefined;
  EtapeDetail: { etapeId: number; etapeUuid: string };
  MesAnomalies: { programmeUuid: string; programmeNumero: string };
};
