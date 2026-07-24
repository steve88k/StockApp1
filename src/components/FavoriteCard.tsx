import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {FavoriteLiveItem} from '../types/favorite';
import {colors} from '../theme/colors';

type Props = {
  item: FavoriteLiveItem;
  onPress?: () => void;
  onRemove?: () => void;
};

function formatPrice(value: number | null | undefined, currency?: string) {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }
  const suffix = currency ? ` ${currency}` : '';
  return `${value.toFixed(2)}${suffix}`;
}

function formatPredicted(probability: number | null | undefined) {
  if (probability == null || !Number.isFinite(probability)) {
    return '--';
  }
  return `${(probability * 100).toFixed(1)}%`;
}

export function FavoriteCard({item, onPress, onRemove}: Props) {
  const hasError = Boolean(item.error);
  const predictedColor =
    item.probability != null && item.probability >= 0.5
      ? colors.success
      : item.probability != null
        ? colors.danger
        : colors.muted;

  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.topRow}>
        <Text style={styles.symbol}>{item.symbol}</Text>
        {onRemove ? (
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={styles.removeBtn}
            accessibilityLabel={`Remove ${item.symbol} from favorites`}>
            <Text style={styles.removeText}>★</Text>
          </Pressable>
        ) : null}
      </View>

      {hasError ? (
        <Text style={styles.errorText}>{item.error}</Text>
      ) : (
        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Price</Text>
            <Text style={styles.price}>
              {formatPrice(item.price, item.currency)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>
              Predicted ≥{item.growth}% / {item.horizon}
            </Text>
            <Text style={[styles.predicted, {color: predictedColor}]}>
              {formatPredicted(item.probability)}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardPressed: {
    opacity: 0.85,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  symbol: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  removeBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  removeText: {
    color: '#f5c542',
    fontSize: 22,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  metric: {
    flex: 1,
    gap: 4,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  price: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  predicted: {
    fontSize: 22,
    fontWeight: '800',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
});
