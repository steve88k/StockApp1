export type PredictionResponse = {
  symbol: string;
  probability: number;
  decision: 'BUY' | 'HOLD' | 'AVOID';
  rationale: string;
};
