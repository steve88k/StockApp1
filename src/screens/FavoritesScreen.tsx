import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {FavoriteCard} from '../components/FavoriteCard';
import {StateCard} from '../components/StateCard';
import {
  loadFavorites,
  removeFavorite,
} from '../services/favoritesStorage';
import {fetchPrediction, fetchStockHistory} from '../services/stockApi';
import {FavoriteLiveItem, FavoriteStock} from '../types/favorite';
import {colors} from '../theme/colors';

type Props = {
  /** Called when user taps a favorite to open it on the search tab */
  onSelectSymbol?: (symbol: string) => void;
};

async function loadLiveItem(fav: FavoriteStock): Promise<FavoriteLiveItem> {
  try {
    const [prediction, history] = await Promise.all([
      fetchPrediction(fav.symbol, fav.horizon, fav.growth),
      fetchStockHistory(fav.symbol, '5d', '1d'),
    ]);

    const latest = history.points[history.points.length - 1];
    return {
      symbol: fav.symbol,
      horizon: fav.horizon,
      growth: fav.growth,
      price: latest?.close ?? null,
      currency: history.currency,
      probability: prediction.probability,
    };
  } catch (e: any) {
    return {
      symbol: fav.symbol,
      horizon: fav.horizon,
      growth: fav.growth,
      price: null,
      probability: null,
      error: e?.message || 'Failed to load data',
    };
  }
}

export function FavoritesScreen({onSelectSymbol}: Props) {
  const [items, setItems] = useState<FavoriteLiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async (isManual = false) => {
    if (isManual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const favorites = await loadFavorites();
      if (!favorites.length) {
        setItems([]);
        return;
      }

      // Fetch price + prediction for each favorite in parallel
      const live = await Promise.all(favorites.map(loadLiveItem));
      setItems(live);
    } catch (e: any) {
      setError(e?.message || 'Failed to load favorites.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Renew every time this screen is mounted (entering fav list)
  useEffect(() => {
    refreshList(false);
  }, [refreshList]);

  const handleRemove = async (symbol: string) => {
    await removeFavorite(symbol);
    setItems(prev => prev.filter(item => item.symbol !== symbol));
  };

  const isBusy = loading || refreshing;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Favorites</Text>
          <Text style={styles.subtitle}>
            Name, live price, and predicted rise probability
          </Text>
        </View>
        <Pressable
          onPress={() => refreshList(true)}
          disabled={isBusy}
          style={[styles.refreshBtn, isBusy && styles.refreshBtnDisabled]}>
          {refreshing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.refreshText}>Refresh</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>
              Updating favorites with latest prices & predictions...
            </Text>
          </View>
        ) : error ? (
          <StateCard title="An error occurred" message={error} tone="error" />
        ) : items.length === 0 ? (
          <StateCard
            title="No favorites yet"
            message="Search a stock and tap ★ Favorite to pin it here."
          />
        ) : (
          <View style={styles.list}>
            {items.map(item => (
              <FavoriteCard
                key={item.symbol}
                item={item}
                onPress={
                  onSelectSymbol
                    ? () => onSelectSymbol(item.symbol)
                    : undefined
                }
                onRemove={() => handleRemove(item.symbol)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 20,
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  refreshBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnDisabled: {
    opacity: 0.7,
  },
  refreshText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    minHeight: 240,
  },
  list: {
    gap: 12,
  },
  loadingBox: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 24,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
});
