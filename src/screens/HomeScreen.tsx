import React, {useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SearchBar} from '../components/SearchBar';
import {ResultCard} from '../components/ResultCard';
import {StateCard} from '../components/StateCard';
import {StockLineChart} from '../components/StockLineChart';
import {StockSummaryCard} from '../components/StockSummaryCard';
import {APP_TITLE, DEFAULT_SYMBOL} from '../constants/labels';
import {fetchPrediction, fetchStockHistory} from '../services/stockApi';
import {PredictionResponse} from '../types/prediction';
import {StockHistoryResponse} from '../types/stock';
import {colors} from '../theme/colors';

export function HomeScreen() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PredictionResponse | null>(null);
  const [stockData, setStockData] = useState<StockHistoryResponse | null>(null);

  const handleSubmit = async () => {
    const cleaned = symbol.trim().toUpperCase();
    if (!cleaned) {
      setError('Please enter the stock ticker first.');
      setData(null);
      setStockData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [predictionResult, stockHistoryResult] = await Promise.all([
        fetchPrediction(cleaned),
        fetchStockHistory(cleaned, '3mo', '1d'),
      ]);

      setData(predictionResult);
      setStockData(stockHistoryResult);
    } catch (e: any) {
      setError(e?.message || 'Search failed. Please enter the ticker symbol again.');
      setData(null);
      setStockData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{APP_TITLE}</Text>
      <Text style={styles.subtitle}>
        Real-time stock data + Offline AI prediction
      </Text>

      <SearchBar
        value={symbol}
        onChangeText={setSymbol}
        onSubmit={handleSubmit}
        loading={loading}
      />

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
            message="Enter a ticker symbol and press Search."
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
