import React, {useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SearchBar} from '../components/SearchBar';
import {ResultCard} from '../components/ResultCard';
import {StateCard} from '../components/StateCard';
import {APP_TITLE, DEFAULT_SYMBOL} from '../constants/labels';
import {fetchPrediction} from '../services/stockApi';
import {PredictionResponse} from '../types/prediction';
import {colors} from '../theme/colors';

export function HomeScreen() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PredictionResponse | null>(null);

  const handleSubmit = async () => {
    const cleaned = symbol.trim().toUpperCase();
    if (!cleaned) {
      setError('Please enter the stock ticker first.');
      setData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await fetchPrediction(cleaned);
      setData(result);
    } catch (e) {
      setError('Search failed. Please enter the ticker symbol again.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{APP_TITLE}</Text>
      <Text style={styles.subtitle}>Android Studio emulator + local backend workflow</Text>

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
        ) : data ? (
          <ResultCard data={data} />
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
    minHeight: 240,
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
