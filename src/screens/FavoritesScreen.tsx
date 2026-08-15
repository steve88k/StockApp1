import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

type SortMode = 'default' | 'predicted';

function matchesQuery(item: FavoriteLiveItem, query: string): boolean {
  const q = query.trim().toUpperCase();
  if (!q) {
    return true;
  }
  return item.symbol.toUpperCase().includes(q);
}

function sortFavorites(
  list: FavoriteLiveItem[],
  mode: SortMode,
): FavoriteLiveItem[] {
  if (mode === 'default') {
    return list;
  }

  return [...list].sort((a, b) => {
    const aHas = a.probability != null && Number.isFinite(a.probability);
    const bHas = b.probability != null && Number.isFinite(b.probability);
    if (aHas && bHas) {
      return (b.probability as number) - (a.probability as number);
    }
    if (aHas) {
      return -1;
    }
    if (bHas) {
      return 1;
    }
    return 0;
  });
}

export function FavoritesScreen({onSelectSymbol}: Props) {
  const [items, setItems] = useState<FavoriteLiveItem[]>([]);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('default');
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
  const trimmedQuery = query.trim();
  const filteredItems = useMemo(
    () => items.filter(item => matchesQuery(item, query)),
    [items, query],
  );
  const displayedItems = useMemo(
    () => sortFavorites(filteredItems, sortMode),
    [filteredItems, sortMode],
  );
  const showSearch = !loading && !error && (items.length > 0 || trimmedQuery.length > 0);
  const showSort = !loading && !error && items.length > 0;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled">
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

      {showSearch ? (
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search favorites by ticker, e.g. AAPL"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="Search favorites"
          />
          {trimmedQuery.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              style={styles.clearBtn}
              accessibilityLabel="Clear search">
              <Text style={styles.clearText}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showSort ? (
        <View style={styles.sortBlock}>
          <Text style={styles.sortLabel}>Sort</Text>
          <View style={styles.sortRow}>
            <Pressable
              onPress={() => setSortMode('default')}
              style={[
                styles.sortChip,
                sortMode === 'default' && styles.sortChipActive,
              ]}
              accessibilityLabel="Default sort">
              <Text
                style={[
                  styles.sortChipText,
                  sortMode === 'default' && styles.sortChipTextActive,
                ]}>
                Default
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSortMode('predicted')}
              style={[
                styles.sortChip,
                sortMode === 'predicted' && styles.sortChipActive,
              ]}
              accessibilityLabel="Sort by predicted percent high to low">
              <Text
                style={[
                  styles.sortChipText,
                  sortMode === 'predicted' && styles.sortChipTextActive,
                ]}>
                Predicted % ↓
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showSearch && items.length > 0 ? (
        <Text style={styles.resultCount}>
          {trimmedQuery
            ? `${displayedItems.length} of ${items.length} favorites`
            : `${items.length} favorite${items.length === 1 ? '' : 's'}`}
        </Text>
      ) : null}

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
        ) : displayedItems.length === 0 ? (
          <StateCard
            title="No matching favorites"
            message={`No saved ticker matches "${trimmedQuery}".`}
          />
        ) : (
          <View style={styles.list}>
            {displayedItems.map(item => (
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
  searchRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingRight: 44,
  },
  clearBtn: {
    position: 'absolute',
    right: 12,
    height: 28,
    width: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardAlt,
  },
  clearText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  sortBlock: {
    gap: 8,
  },
  sortLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sortChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sortChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortChipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  sortChipTextActive: {
    color: '#fff',
  },
  resultCount: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: -8,
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
