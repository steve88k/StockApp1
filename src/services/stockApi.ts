import {PredictionResponse} from '../types/prediction';
import {predict} from '../ml/prediction';
import {FundamentalInfo, PriceBar} from '../ml/featureBuilder';
import {StockHistoryResponse, StockPoint} from '../types/stock';

const MODEL = require('../assets/us_market_model.tflite');

function formatDateLabel(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${month}/${day}`;
}

function formatIsoDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

type ChartParseResult = {
  symbol: string;
  currency?: string;
  exchangeName?: string;
  points: StockPoint[];
  bars: PriceBar[];
};

async function fetchYahooChart(
  symbol: string,
  range: string,
  interval: string,
): Promise<ChartParseResult> {
  const cleaned = symbol.trim().toUpperCase();
  if (!cleaned) {
    throw new Error('Please enter the ticker symbol first.');
  }

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleaned)}` +
    `?range=${encodeURIComponent(range)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&includePrePost=false`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {Accept: 'application/json'},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch stock data：HTTP ${response.status}`);
  }

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const error = json?.chart?.error;

  if (error) {
    throw new Error(error?.description || 'Yahoo Finance Return an error');
  }

  if (!result) {
    throw new Error('No stock data found.');
  }

  const timestamps: number[] = result.timestamp ?? [];
  const meta = result.meta ?? {};
  const quote = result.indicators?.quote?.[0] ?? {};

  const closes: Array<number | null> = quote.close ?? [];
  const opens: Array<number | null> = quote.open ?? [];
  const highs: Array<number | null> = quote.high ?? [];
  const lows: Array<number | null> = quote.low ?? [];
  const volumes: Array<number | null> = quote.volume ?? [];

  const points: StockPoint[] = [];
  const bars: PriceBar[] = [];

  timestamps.forEach((ts, index) => {
    const close = closes[index];
    if (close == null || !Number.isFinite(close)) {
      return;
    }

    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const volume = volumes[index];

    const point: StockPoint = {
      timestamp: ts,
      dateLabel: formatDateLabel(ts),
      close,
    };
    if (open != null && Number.isFinite(open)) point.open = open;
    if (high != null && Number.isFinite(high)) point.high = high;
    if (low != null && Number.isFinite(low)) point.low = low;
    if (volume != null && Number.isFinite(volume)) point.volume = volume;
    points.push(point);

    const bar: PriceBar = {
      date: formatIsoDate(ts),
      close,
    };
    if (open != null && Number.isFinite(open)) bar.open = open;
    if (high != null && Number.isFinite(high)) bar.high = high;
    if (low != null && Number.isFinite(low)) bar.low = low;
    if (volume != null && Number.isFinite(volume)) bar.volume = volume;
    bars.push(bar);
  });

  if (!points.length) {
    throw new Error('No data available for this date range.');
  }

  return {
    symbol: meta.symbol || cleaned,
    currency: meta.currency,
    exchangeName: meta.exchangeName,
    points,
    bars,
  };
}

export async function getHistory(symbol: string): Promise<PriceBar[]> {
  const upper = symbol.trim().toUpperCase();
  if (!upper) throw new Error('Missing symbol');

  const chart = await fetchYahooChart(upper, '2y', '1d');
  return chart.bars;
}

export async function getInfo(symbol: string): Promise<FundamentalInfo> {
  const upper = symbol.trim().toUpperCase();
  if (!upper) throw new Error('Missing symbol');
  return {};
}

function toDecision(probability: number): PredictionResponse['decision'] {
  if (probability >= 0.6) return 'BUY';
  if (probability >= 0.45) return 'HOLD';
  return 'AVOID';
}

export async function fetchPrediction(symbol: string): Promise<PredictionResponse> {
  const upper = symbol.trim().toUpperCase();
  if (!upper) throw new Error('Missing symbol');

  const [history, info] = await Promise.all([getHistory(upper), getInfo(upper)]);

  if (!history.length) {
    throw new Error('No price history available for prediction.');
  }

  if (info.currentPrice == null) {
    info.currentPrice = history[history.length - 1]?.close;
  }

  const result = await predict(MODEL, history, info);
  const probability = Number.isFinite(result.score)
    ? Math.max(0, Math.min(1, result.score))
    : 0;

  return {
    symbol: upper,
    probability,
    decision: toDecision(probability),
    rationale: `Inference on the（${history.length} daily chart）has been executed using a local TFLite model in React Native`,
  };
}

export async function fetchStockHistory(
  symbol: string,
  range: string = '3mo',
  interval: string = '1d',
): Promise<StockHistoryResponse> {
  const chart = await fetchYahooChart(symbol, range, interval);

  return {
    symbol: chart.symbol,
    range,
    interval,
    currency: chart.currency,
    exchangeName: chart.exchangeName,
    points: chart.points,
  };
}
