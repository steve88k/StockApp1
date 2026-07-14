/**
 * StockApp1 - React Native Stock Prediction App
 */

import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {HomeScreen} from './src/screens/HomeScreen';
import {colors} from './src/theme/colors';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <HomeScreen />
    </SafeAreaProvider>
  );
}

export default App;
