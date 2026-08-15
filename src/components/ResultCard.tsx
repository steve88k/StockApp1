import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {PredictionResponse} from '../types/prediction';
import {colors} from '../theme/colors';

type Props = {
  data: PredictionResponse;
};

type RationalePart = {
  label: string;
  value: string;
  detail: string;
};

export function explainRationalePart(part: string): RationalePart {
  const target = part.match(/^≥(\d+)%\s+in\s+(\d+m)$/i);
  if (target) {
    return {
      label: 'Target',
      value: part,
      detail: `Chance this stock rises at least ${target[1]}% over the next ${target[2]}. That is the percentage shown above.`,
    };
  }

  const bars = part.match(/^TFLite on (\d+) daily bars$/i);
  if (bars) {
    return {
      label: 'Price history',
      value: part,
      detail: `The on-device model used ${bars[1]} daily candles (about 2 years). Returns, moving averages, and volatility come from these bars.`,
    };
  }

  const sentOk = part.match(/^sentiment\s+(-?[\d.]+)\s+\((\d+)\s+news\)$/i);
  if (sentOk) {
    const score = Number(sentOk[1]);
    const n = sentOk[2];
    const tone =
      score > 0.15
        ? 'leaning positive'
        : score < -0.15
          ? 'leaning negative'
          : 'roughly neutral';
    return {
      label: 'News sentiment',
      value: part,
      detail: `Average score of ${n} Yahoo headlines from the last 7 days (${tone}). Score is P(positive) − P(negative), about −1 to +1. Values near 0 are common.`,
    };
  }

  if (/sentiment=0/i.test(part)) {
    return {
      label: 'News sentiment',
      value: part,
      detail:
        'No recent headlines, or the on-device sentiment model did not load. The three sentiment features were sent as 0.',
    };
  }

  const fundOk = part.match(/^fundamentals\s+(\d+)$/i);
  if (fundOk) {
    return {
      label: 'Fundamentals',
      value: part,
      detail: `${fundOk[1]} fundamental fields (P/E, margins, analyst targets, and similar) were loaded from Yahoo.`,
    };
  }

  if (/fundamentals=0/i.test(part)) {
    return {
      label: 'Fundamentals',
      value: part,
      detail:
        'Fundamentals could not be fetched (auth, rate limit, or a slow response). Those model inputs were 0. Current price still falls back to the last close.',
    };
  }

  return {
    label: 'Detail',
    value: part,
    detail: part,
  };
}

export function splitRationale(rationale: string): RationalePart[] {
  return rationale
    .split('|')
    .map(item => item.trim())
    .filter(Boolean)
    .map(explainRationalePart);
}

export function ResultCard({data}: Props) {
  const [expanded, setExpanded] = useState(false);
  const parts = useMemo(() => splitRationale(data.rationale), [data.rationale]);

  useEffect(() => {
    setExpanded(false);
  }, [data.symbol, data.rationale]);

  return (
    <View style={styles.card}>
      <Text style={styles.symbol}>{data.symbol}</Text>
      <Text style={styles.probability}>
        {(data.probability * 100).toFixed(1)}%
      </Text>
      <Text style={styles.decision}>Recommendation: {data.decision}</Text>
      <Text style={styles.rationale}>{data.rationale}</Text>

      <Pressable
        onPress={() => setExpanded(open => !open)}
        style={({pressed}) => [
          styles.toggle,
          expanded && styles.toggleOpen,
          pressed && styles.togglePressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{expanded}}
        accessibilityLabel={
          expanded ? 'Hide rationale explanation' : 'Show rationale explanation'
        }>
        <Text style={[styles.toggleText, expanded && styles.toggleTextOpen]}>
          {expanded ? 'Hide explanation' : 'What this means'}
        </Text>
        <Text style={[styles.toggleChevron, expanded && styles.toggleTextOpen]}>
          {expanded ? '▴' : '▾'}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={styles.explainBox}>
          {parts.map((part, index) => (
            <View
              key={`${part.label}-${index}`}
              style={[
                styles.explainItem,
                index === parts.length - 1 && styles.explainItemLast,
              ]}>
              <Text style={styles.explainLabel}>{part.label}</Text>
              <Text style={styles.explainValue}>{part.value}</Text>
              <Text style={styles.explainDetail}>{part.detail}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
  toggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toggleOpen: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  togglePressed: {
    opacity: 0.85,
  },
  toggleText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  toggleTextOpen: {
    color: '#fff',
  },
  toggleChevron: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  explainBox: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  explainItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 4,
  },
  explainItemLast: {
    borderBottomWidth: 0,
  },
  explainLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  explainValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  explainDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
});
