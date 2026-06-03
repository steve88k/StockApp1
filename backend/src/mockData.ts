export function getMockPrediction(symbol: string) {
  const upper = symbol.toUpperCase();
  const probabilityMap: Record<string, number> = {
    AAPL: 0.71,
    NVDA: 0.64,
    TSLA: 0.42,
    MSFT: 0.58,
  };

  const probability = probabilityMap[upper] ?? 0.37;
  const decision = probability >= 0.6 ? 'BUY' : probability >= 0.45 ? 'HOLD' : 'AVOID';

  return {
    symbol: upper,
    probability,
    decision,
    rationale: '目前為 mock 回傳，之後可在 predictorService 替換成真實模型推論結果。',
  };
}
