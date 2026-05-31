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
