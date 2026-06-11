/**
 * Point d'entrée de l'application Expo.
 *
 * Ce fichier est le composant racine monté par Expo au démarrage.
 * Il configure la StatusBar (texte blanc sur fonds sombres) et
 * délègue toute la logique de navigation à RootNavigator.
 *
 * L'application utilise un fond navy sombre
 * sur l'écran de connexion et un fond bleu Sodigaz sur les entêtes.
 * style="light" garantit que le texte de la barre de statut (heure,
 * batterie) reste blanc et visible sur ces fonds sombres.
 */
import React from 'react';
import { StatusBar } from 'expo-status-bar';

import RootNavigator from './src/navigation/RootNavigator';

export default function App(): React.ReactElement {
  return (
    <>
      <StatusBar style="light" />
      <RootNavigator />
    </>
  );
}
