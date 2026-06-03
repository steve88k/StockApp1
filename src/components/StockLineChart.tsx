import React from 'react';
import {Dimensions, ScrollView, StyleSheet, Text, View} from 'react-native';
import {LineChart} from 'react-native-chart-kit';
import {StockHistoryResponse} from '../types/stock';
import {colors} from '../theme/colors';

type Props = {
  data: StockHistoryResponse;
};

export function StockLineChart({data}: Props) {
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(screenWidth - 40, data.points.length * 18);

  const labels = data.points.map((point, index) => {
    const step = Math.max(1, Math.floor(data.points.length / 6));
    return index % step === 0 ? point.dateLabel : '';
  });

  const prices = data.points.map(point => Number(point.close.toFixed(2)));

  return (
    <View style={styles.card}>
      <Text style={styles.title}>收盤價走勢</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <LineChart
          data={{labels, datasets: [{data: prices}]}}
          width={chartWidth}
          height={240}
          withDots={false}
          withInnerLines={true}
          withOuterLines={false}
          withVerticalLines={false}
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
  chart: {
    borderRadius: 16,
    paddingRight: 16,
  },
});
