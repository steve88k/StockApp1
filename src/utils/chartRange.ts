import {StockHistoryResponse, StockPoint} from '../types/stock';

export type ChartDisplayRange = '7d' | '3m' | '6m' | '12m';

export const CHART_DISPLAY_RANGES: ChartDisplayRange[] = [
  '7d',
  '3m',
  '6m',
  '12m',
];

export const CHART_DISPLAY_LABELS: Record<ChartDisplayRange, string> = {
  '7d': '7D',
  '3m': '3M',
  '6m': '6M',
  '12m': '12M',
};

/** Calendar-second windows from the latest bar. */
const RANGE_SECONDS: Record<ChartDisplayRange, number> = {
  '7d': 7 * 86400,
  '3m': 91 * 86400,
  '6m': 182 * 86400,
  '12m': 365 * 86400,
};

function slicePoints(
  points: StockPoint[],
  range: ChartDisplayRange,
): StockPoint[] {
  if (points.length < 2) {
    return points;
  }
  const end = points[points.length - 1].timestamp;
  const start = end - RANGE_SECONDS[range];
  const sliced = points.filter(point => point.timestamp >= start);
  return sliced.length >= 2 ? sliced : points.slice(-2);
}

export function sliceStockHistory(
  data: StockHistoryResponse,
  range: ChartDisplayRange,
): StockHistoryResponse {
  return {
    ...data,
    range,
    points: slicePoints(data.points, range),
  };
}
