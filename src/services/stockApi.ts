import {PredictionResponse} from '../types/prediction';

const probabilityMap: Record<string, number> = {
  AAPL: 0.71,
  NVDA: 0.64,
  TSLA: 0.42,
  MSFT: 0.58,
};

export async function fetchPrediction(symbol: string): Promise<PredictionResponse> {
  const upper = symbol.trim().toUpperCase();

  if (!upper) {
    throw new Error('Missing symbol');
  }

  const probability = probabilityMap[upper] ?? 0.37;
  const decision =
    probability >= 0.6 ? 'BUY' :
    probability >= 0.45 ? 'HOLD' :
    'AVOID';

  return {
    symbol: upper,
    probability,
    decision,
    rationale: '目前為本機 mock 預測結果，不需連接 backend。',
  };
}