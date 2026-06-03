import {PredictionResponse} from '../types/prediction';
import {StockHistoryResponse, StockPoint} from '../types/stock';

const probabilityMap: Record<string, number> = {
  AAPL: 0.71,
  NVDA: 0.64,
  TSLA: 0.42,
  MSFT: 0.58,
};

function formatDateLabel(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${month}/${day}`;
}

export async function fetchPrediction(symbol: string): Promise<PredictionResponse> {
  const upper = symbol.trim().toUpperCase();

  if (!upper) {
    throw new Error('Missing symbol');
  }

  const probability = probabilityMap[upper] ?? 0.37;
  const decision = probability >= 0.6 ? 'BUY' : probability >= 0.45 ? 'HOLD' : 'AVOID';

  return {
    symbol: upper,
    probability,
    decision,
    rationale: '目前為本機 mock 預測結果，可之後替換成 TFLite 離線推論。',
  };
}

export async function fetchStockHistory(
  symbol: string,
  range: string = '3mo',
  interval: string = '1d',
): Promise<StockHistoryResponse> {
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

  const points: StockPoint[] = timestamps
  .map((ts, index) => {
    const close = closes[index];
    if (close == null || !Number.isFinite(close)) {
      return null;
    }

    const point: StockPoint = {
      timestamp: ts,
      dateLabel: formatDateLabel(ts),
      close,
    };

    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const volume = volumes[index];

    if (open != null && Number.isFinite(open)) {
      point.open = open;
    }
    if (high != null && Number.isFinite(high)) {
      point.high = high;
    }
    if (low != null && Number.isFinite(low)) {
      point.low = low;
    }
    if (volume != null && Number.isFinite(volume)) {
      point.volume = volume;
    }

    return point;
  })
  .filter((item): item is StockPoint => item !== null);

  if (!points.length) {
    throw new Error('No data available for this date range.');
  }

  return {
    symbol: meta.symbol || cleaned,
    range,
    interval,
    currency: meta.currency,
    exchangeName: meta.exchangeName,
    points,
  };
}
