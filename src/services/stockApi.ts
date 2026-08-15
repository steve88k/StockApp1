import {PredictionResponse} from '../types/prediction';
import {
  Growth,
  Horizon,
  outputKey,
  pickProbability,
  predict,
} from '../ml/prediction';
import {FundamentalInfo, PriceBar} from '../ml/featureBuilder';
import {computeSentimentFeatures} from '../ml/sentiment';
import {StockHistoryResponse, StockPoint} from '../types/stock';
import {
  countFilledFundamentals,
  fetchYahooFundamentals,
  YAHOO_UA,
} from './yahooFundamentals';

const MODEL = require('../assets/us_market_model.tflite');

/** Decision thresholds from threshold_summary.csv (best F1 per head). */
const DECISION_THR: Record<string, number> = {
  y_3m_10: 0.28,
  y_3m_20: 0.23,
  y_3m_30: 0.23,
  y_6m_10: 0.28,
  y_6m_20: 0.24,
  y_6m_30: 0.22,
  y_9m_10: 0.27,
  y_9m_20: 0.23,
  y_9m_30: 0.23,
  y_12m_10: 0.28,
  y_12m_20: 0.24,
  y_12m_30: 0.24,
};

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

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': YAHOO_UA,
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

/** History for model features — need ~252 trading days. */
export async function getHistory(symbol: string): Promise<PriceBar[]> {
  const upper = cleanSymbol(symbol);
  if (!upper) throw new Error('Missing symbol');

  const chart = await fetchYahooChart(upper, '2y', '1d');
  return chart.bars;
}

/** Yahoo quoteSummary (cookie + crumb). Returns {} if auth or network fails. */
export async function getInfo(symbol: string): Promise<FundamentalInfo> {
  const upper = cleanSymbol(symbol);
  if (!upper) throw new Error('Missing symbol');

  try {
    return await fetchYahooFundamentals(upper);
  } catch (error) {
    console.warn('[getInfo] fundamentals unavailable, using empty info', error);
    return {};
  }
}

function toDecision(
  probability: number,
  key: string,
): PredictionResponse['decision'] {
  const thr = DECISION_THR[key] ?? 0.15;
  if (probability >= thr + 0.1) return 'BUY';
  if (probability >= thr) return 'HOLD';
  return 'AVOID';
}

/**
 * Offline multi-horizon prediction + on-device news sentiment.
 * @param horizon 3m | 6m | 9m | 12m
 * @param growth 10 | 20 | 30  (percent threshold)
 */
export async function fetchPrediction(
  symbol: string,
  horizon: Horizon = '12m',
  growth: Growth = '30',
): Promise<PredictionResponse> {
  const upper = cleanSymbol(symbol);
  if (!upper) throw new Error('Missing symbol');

  // Parallel: price history + fundamentals + news sentiment
  const [history, info, sentiment] = await Promise.all([
    getHistory(upper),
    getInfo(upper),
    computeSentimentFeatures(upper),
  ]);

  if (!history.length) {
    throw new Error('No price history available for prediction.');
  }

  const fundFilled = countFilledFundamentals(info);
  if (info.currentPrice == null) {
    info.currentPrice = history[history.length - 1]?.close;
  }

  const result = await predict(MODEL, history, info, sentiment);
  const key = outputKey(horizon, growth);
  const probability = pickProbability(result.probs, horizon, growth);

  const sentNote =
    sentiment.news_count_7d > 0
      ? ` | sentiment ${sentiment.sentiment_score.toFixed(2)} (${sentiment.news_count_7d} news)`
      : ' | sentiment=0 (no recent news / model missing)';
  const fundNote =
    fundFilled > 0
      ? ` | fundamentals ${fundFilled}`
      : ' | fundamentals=0';

  return {
    symbol: upper,
    probability,
    decision: toDecision(probability, key),
    rationale: `≥${growth}% in ${horizon} | TFLite on ${history.length} daily bars${sentNote}${fundNote}`,
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
