import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {PredictionResponse} from '../types/prediction';
import {colors} from '../theme/colors';

type Props = {
  data: PredictionResponse;
};

export function ResultCard({data}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.symbol}>{data.symbol}</Text>
      <Text style={styles.probability}>{(data.probability * 100).toFixed(1)}%</Text>
      <Text style={styles.decision}>Suggestion: {data.decision}</Text>
      <Text style={styles.rationale}>{data.rationale}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  symbol: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  probability: {
    color: colors.success,
    fontSize: 32,
    fontWeight: '800',
  },
  decision: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rationale: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
  },
});
