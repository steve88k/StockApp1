import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SearchBar} from '../components/SearchBar';
import {ResultCard} from '../components/ResultCard';
import {StateCard} from '../components/StateCard';
import {StockLineChart} from '../components/StockLineChart';
import {StockSummaryCard} from '../components/StockSummaryCard';
import {APP_TITLE, DEFAULT_SYMBOL} from '../constants/labels';
import {
  isFavorite as checkIsFavorite,
  toggleFavorite,
} from '../services/favoritesStorage';
import {fetchPrediction, fetchStockHistory} from '../services/stockApi';
import {Growth, Horizon} from '../ml/prediction';
import {PredictionResponse} from '../types/prediction';
import {StockHistoryResponse} from '../types/stock';
import {colors} from '../theme/colors';

const HORIZONS: Horizon[] = ['3m', '6m', '9m', '12m'];
const GROWTHS: Growth[] = ['10', '20', '30'];

type Props = {
  /** Prefill / search this symbol when navigating from favorites */
  initialSymbol?: string | null;
  onInitialSymbolConsumed?: () => void;
};

export function HomeScreen({
  initialSymbol,
  onInitialSymbolConsumed,
}: Props) {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [horizon, setHorizon] = useState<Horizon>('12m');
  const [growth, setGrowth] = useState<Growth>('30');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PredictionResponse | null>(null);
  const [stockData, setStockData] = useState<StockHistoryResponse | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);

  const syncFavoriteState = async (ticker: string) => {
    const cleaned = ticker.trim().toUpperCase();
    if (!cleaned) {
      setFavorited(false);
      return;
    }
    const fav = await checkIsFavorite(cleaned);
    setFavorited(fav);
  };

  // Keep star state in sync with the typed ticker
  useEffect(() => {
    syncFavoriteState(symbol);
  }, [symbol]);

  const handleSubmit = async (
    nextHorizon: Horizon = horizon,
    nextGrowth: Growth = growth,
    nextSymbol?: string,
  ) => {
    const cleaned = (nextSymbol ?? symbol).trim().toUpperCase();
    if (!cleaned) {
      setError('Please enter the stock ticker first.');
      setData(null);
      setStockData(null);
      setFavorited(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSymbol(cleaned);

      const [predictionResult, stockHistoryResult] = await Promise.all([
        fetchPrediction(cleaned, nextHorizon, nextGrowth),
        fetchStockHistory(cleaned, '1y', '1d'),
      ]);

      setData(predictionResult);
      setStockData(stockHistoryResult);
      await syncFavoriteState(cleaned);
    } catch (e: any) {
      setError(
        e?.message || 'Search failed. Please enter the ticker symbol again.',
      );
      setData(null);
      setStockData(null);
    } finally {
      setLoading(false);
    }
  };

  // Open symbol from favorites tab
  useEffect(() => {
    if (!initialSymbol) {
      return;
    }
    const cleaned = initialSymbol.trim().toUpperCase();
    if (!cleaned) {
      onInitialSymbolConsumed?.();
      return;
    }
    setSymbol(cleaned);
    handleSubmit(horizon, growth, cleaned);
    onInitialSymbolConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol]);

  const onSelectHorizon = (h: Horizon) => {
    setHorizon(h);
    if (symbol.trim()) {
      handleSubmit(h, growth);
    }
  };

  const onSelectGrowth = (g: Growth) => {
    setGrowth(g);
    if (symbol.trim()) {
      handleSubmit(horizon, g);
    }
  };

  const onToggleFavorite = async () => {
    const cleaned = (data?.symbol || symbol).trim().toUpperCase();
    if (!cleaned) {
      setError('Please enter the stock ticker first.');
      return;
    }

    try {
      setFavoriteBusy(true);
      const result = await toggleFavorite(cleaned, horizon, growth);
      setFavorited(result.isFavorite);
    } catch (e: any) {
      setError(e?.message || 'Failed to update favorites.');
    } finally {
      setFavoriteBusy(false);
    }
  };

  const canFavorite = Boolean(
    (data?.symbol || symbol.trim()) && !loading,
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{APP_TITLE}</Text>
      <Text style={styles.subtitle}>
        Real-time stock data + Offline AI prediction
      </Text>

      <SearchBar
        value={symbol}
        onChangeText={setSymbol}
        onSubmit={() => handleSubmit()}
        loading={loading}
      />

      <View style={styles.selectorBlock}>
        <Text style={styles.selectorLabel}>Time horizon</Text>
        <View style={styles.chipRow}>
          {HORIZONS.map(h => (
            <Pressable
              key={h}
              onPress={() => onSelectHorizon(h)}
              style={[styles.chip, horizon === h && styles.chipActive]}>
              <Text
                style={[
                  styles.chipText,
                  horizon === h && styles.chipTextActive,
                ]}>
                {h}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.selectorLabel}>Target gain</Text>
        <View style={styles.chipRow}>
          {GROWTHS.map(g => (
            <Pressable
              key={g}
              onPress={() => onSelectGrowth(g)}
              style={[styles.chip, growth === g && styles.chipActive]}>
              <Text
                style={[
                  styles.chipText,
                  growth === g && styles.chipTextActive,
                ]}>
                ≥{g}%
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {canFavorite ? (
        <Pressable
          onPress={onToggleFavorite}
          disabled={favoriteBusy}
          style={[
            styles.favoriteBtn,
            favorited && styles.favoriteBtnActive,
            favoriteBusy && styles.favoriteBtnDisabled,
          ]}>
          {favoriteBusy ? (
            <ActivityIndicator
              size="small"
              color={favorited ? '#1a1400' : colors.primary}
            />
          ) : (
            <Text
              style={[
                styles.favoriteBtnText,
                favorited && styles.favoriteBtnTextActive,
              ]}>
              {favorited ? '★ Favorited' : '☆ Add to favorites'}
            </Text>
          )}
        </Pressable>
      ) : null}

      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Fetching prediction data...</Text>
          </View>
        ) : error ? (
          <StateCard title="An error occurred" message={error} tone="error" />
        ) : data && stockData ? (
          <View style={styles.resultGroup}>
            <StockSummaryCard data={stockData} />
            <StockLineChart data={stockData} />
            <ResultCard data={data} />
          </View>
        ) : (
          <StateCard
            title="No search yet"
            message="Enter a ticker, pick horizon & gain, then Search."
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 20,
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
  selectorBlock: {
    gap: 10,
  },
  selectorLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
  favoriteBtn: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 42,
    justifyContent: 'center',
  },
  favoriteBtnActive: {
    backgroundColor: '#f5c542',
    borderColor: '#f5c542',
  },
  favoriteBtnDisabled: {
    opacity: 0.7,
  },
  favoriteBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  favoriteBtnTextActive: {
    color: '#1a1400',
  },
  content: {
    minHeight: 320,
  },
  resultGroup: {
    gap: 16,
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
  },
});
