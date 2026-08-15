import React, {useMemo} from 'react';
import {Dimensions, ScrollView, StyleSheet, Text, View} from 'react-native';
import {LineChart} from 'react-native-chart-kit';
import {StockHistoryResponse} from '../types/stock';
import {colors} from '../theme/colors';
import {
  CHART_DISPLAY_LABELS,
  ChartDisplayRange,
} from '../utils/chartRange';

type Props = {
  data: StockHistoryResponse;
  displayRange?: ChartDisplayRange;
};

const CHART_HEIGHT = 240;
const PADDING_TOP = 16;
const PLOT_HEIGHT_RATIO = 0.75;
const SEGMENTS = 4;
const Y_AXIS_WIDTH = 62;
const PLOT_LEFT_INSET = 8;

type PriceTick = {
  value: number;
  top: number;
};

function buildPriceTicks(prices: number[]): PriceTick[] {
  const finite = prices.filter(value => Number.isFinite(value));
  if (!finite.length) {
    return [];
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const basePosition = CHART_HEIGHT * PLOT_HEIGHT_RATIO;

  if (min === max) {
    return [{value: min, top: basePosition + PADDING_TOP}];
  }

  const scaler = max - min;
  return Array.from({length: SEGMENTS + 1}, (_, i) => ({
    value: (scaler / SEGMENTS) * i + min,
    top: basePosition - (basePosition / SEGMENTS) * i + PADDING_TOP,
  }));
}

export function StockLineChart({data, displayRange}: Props) {
  const screenWidth = Dimensions.get('window').width;
  const plotWidth = Math.max(
    screenWidth - 40 - Y_AXIS_WIDTH,
    data.points.length * 18,
  );

  const labels = data.points.map((point, index) => {
    const step = Math.max(1, Math.floor(data.points.length / 6));
    return index % step === 0 ? point.dateLabel : '';
  });

  const prices = data.points.map(point => Number(point.close.toFixed(2)));
  const ticks = useMemo(() => buildPriceTicks(prices), [prices]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        Closing Price Trend
        {displayRange ? ` · ${CHART_DISPLAY_LABELS[displayRange]}` : ''}
      </Text>
      <View style={styles.plotRow}>
        <View style={styles.yAxis} pointerEvents="none">
          {ticks.map(tick => (
            <Text
              key={`${tick.value}-${tick.top}`}
              style={[styles.yTick, {top: tick.top - 7}]}>
              {tick.value.toFixed(2)}
            </Text>
          ))}
        </View>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.plotScroll}>
          <LineChart
            data={{labels, datasets: [{data: prices}]}}
            width={plotWidth}
            height={CHART_HEIGHT}
            withDots={false}
            withInnerLines
            withOuterLines={false}
            withVerticalLines={false}
            withHorizontalLabels={false}
            bezier
            chartConfig={{
              backgroundColor: colors.card,
              backgroundGradientFrom: colors.card,
              backgroundGradientTo: colors.card,
              decimalPlaces: 2,
              color: (opacity = 1) => `rgba(120, 183, 255, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(154, 172, 201, ${opacity})`,
              propsForBackgroundLines: {stroke: '#26324a'},
              propsForLabels: {fontSize: 11},
            }}
            style={styles.chart}
          />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
  },
  plotRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    height: CHART_HEIGHT,
    position: 'relative',
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingRight: 6,
  },
  yTick: {
    position: 'absolute',
    right: 6,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    textAlign: 'right',
  },
  plotScroll: {
    flex: 1,
  },
  chart: {
    borderRadius: 16,
    paddingTop: PADDING_TOP,
    paddingRight: PLOT_LEFT_INSET,
  },
});
