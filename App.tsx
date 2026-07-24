/**
 * StockApp1 - React Native Stock Prediction App
 */

import React, {useState} from 'react';
import {Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {FavoritesScreen} from './src/screens/FavoritesScreen';
import {HomeScreen} from './src/screens/HomeScreen';
import {colors} from './src/theme/colors';

type Tab = 'search' | 'favorites';

function AppShell() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('search');
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  /** Bumps when opening Favorites so the list remounts and refreshes */
  const [favoritesVisitId, setFavoritesVisitId] = useState(0);

  const openFavorites = () => {
    setFavoritesVisitId(id => id + 1);
    setTab('favorites');
  };

  const openSymbolFromFavorites = (symbol: string) => {
    setPendingSymbol(symbol);
    setTab('search');
  };

  return (
    <View
      style={[
        styles.shell,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <View style={styles.screen}>
        {/* Keep Search mounted so query/results survive tab switches */}
        <View
          style={[styles.page, tab !== 'search' && styles.pageHidden]}
          pointerEvents={tab === 'search' ? 'auto' : 'none'}>
          <HomeScreen
            initialSymbol={pendingSymbol}
            onInitialSymbolConsumed={() => setPendingSymbol(null)}
          />
        </View>

        {tab === 'favorites' ? (
          <View style={styles.page}>
            <FavoritesScreen
              key={favoritesVisitId}
              onSelectSymbol={openSymbolFromFavorites}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab('search')}
          style={[styles.tab, tab === 'search' && styles.tabActive]}>
          <Text
            style={[styles.tabText, tab === 'search' && styles.tabTextActive]}>
            Search
          </Text>
        </Pressable>
        <Pressable
          onPress={openFavorites}
          style={[styles.tab, tab === 'favorites' && styles.tabActive]}>
          <Text
            style={[
              styles.tabText,
              tab === 'favorites' && styles.tabTextActive,
            ]}>
            ★ Favorites
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function App() {
  return (
    <SafeAreaProvider style={styles.container}>
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  pageHidden: {
    display: 'none',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#fff',
  },
});

export default App;
