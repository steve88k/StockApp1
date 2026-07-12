/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from 'react';
import { StatusBar, StyleSheet} from 'react-native';
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

export default App;
