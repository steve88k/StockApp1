import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {StockHistoryResponse} from '../types/stock';
import {colors} from '../theme/colors';

type Props = {
  data: StockHistoryResponse;
};

function formatPrice(value?: number) {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toFixed(2);
}

export function StockSummaryCard({data}: Props) {
  const latest = data.points[data.points.length - 1];
  const first = data.points[0];
  const change = latest.close - first.close;
  const changePct = (change / first.close) * 100;
  const positive = change >= 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.symbol}>{data.symbol}</Text>
        <Text style={styles.exchange}>{data.exchangeName || 'Yahoo Finance'}</Text>
      </View>

      <Text style={styles.price}>
        {formatPrice(latest.close)} {data.currency || ''}
      </Text>

      <Text style={[styles.change, positive ? styles.positive : styles.negative]}>
        {positive ? '+' : ''}{change.toFixed(2)} ({positive ? '+' : ''}{changePct.toFixed(2)}%)
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>Range: {data.range}</Text>
        <Text style={styles.meta}>Interval: {data.interval}</Text>
        <Text style={styles.meta}>Number of data points: {data.points.length}</Text>
      </View>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  symbol: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  exchange: {
    color: colors.muted,
    fontSize: 12,
  },
  price: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
  },
  change: {
    fontSize: 16,
    fontWeight: '700',
  },
  positive: {
    color: colors.success,
  },
  negative: {
    color: colors.danger,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
  },
});
