import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {StockHistoryResponse} from '../types/stock';
import {colors} from '../theme/colors';
import {
  CHART_DISPLAY_LABELS,
  CHART_DISPLAY_RANGES,
  ChartDisplayRange,
} from '../utils/chartRange';

type Props = {
  data: StockHistoryResponse;
  displayRange: ChartDisplayRange;
  onDisplayRangeChange: (range: ChartDisplayRange) => void;
};

function formatPrice(value?: number) {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toFixed(2);
}

export function StockSummaryCard({
  data,
  displayRange,
  onDisplayRangeChange,
}: Props) {
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

      <View style={styles.rangeRow}>
        {CHART_DISPLAY_RANGES.map(range => {
          const active = range === displayRange;
          return (
            <Pressable
              key={range}
              onPress={() => onDisplayRangeChange(range)}
              style={[styles.rangeChip, active && styles.rangeChipActive]}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              accessibilityLabel={`Show ${CHART_DISPLAY_LABELS[range]} chart`}>
              <Text
                style={[
                  styles.rangeChipText,
                  active && styles.rangeChipTextActive,
                ]}>
                {CHART_DISPLAY_LABELS[range]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          Range: {CHART_DISPLAY_LABELS[displayRange]}
        </Text>
        <Text style={styles.meta}>Interval: {data.interval}</Text>
        <Text style={styles.meta}>Data points: {data.points.length}</Text>
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
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  rangeChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rangeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  rangeChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  rangeChipTextActive: {
    color: '#fff',
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
