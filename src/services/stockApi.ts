import {PredictionResponse} from '../types/prediction';
import {predict} from '../ml/prediction';
import {FundamentalInfo, PriceBar} from '../ml/featureBuilder';
import {StockHistoryResponse, StockPoint} from '../types/stock';

const MODEL = require('../assets/us_market_model.tflite');

// Helper to clean and normalize stock symbol
function cleanSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

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
  const cleaned = cleanSymbol(symbol);
  if (!cleaned) {
    throw new Error('Please enter the ticker symbol first.');
  }

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleaned)}` +
    `?range=${encodeURIComponent(range)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&includePrePost=false`;

  // Yahoo often rejects bare mobile clients without a browser-like User-Agent.
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch stock data: HTTP ${response.status}`);
  }

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const error = json?.chart?.error;

  if (error) {
    throw new Error(error?.description || 'Yahoo Finance returned an error');
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
  const upper = cleanSymbol(symbol);
  if (!upper) throw new Error('Missing symbol');

  const chart = await fetchYahooChart(upper, '2y', '1d');
  return chart.bars;
}

export async function getInfo(symbol: string): Promise<FundamentalInfo> {
  const upper = cleanSymbol(symbol);
  if (!upper) throw new Error('Missing symbol');
  // TODO: Implement real fundamental data fetch if needed
  return {};
}

function toDecision(probability: number): PredictionResponse['decision'] {
  if (probability >= 0.6) return 'BUY';
  if (probability >= 0.45) return 'HOLD';
  return 'AVOID';
}

export async function fetchPrediction(symbol: string): Promise<PredictionResponse> {
  const upper = cleanSymbol(symbol);
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
    rationale: `Local TFLite model inference completed on ${history.length} days of daily chart data.`,
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
