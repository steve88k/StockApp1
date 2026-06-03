export type StockPoint = {
  timestamp: number;
  dateLabel: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
};

export type StockHistoryResponse = {
  symbol: string;
  range: string;
  interval: string;
  currency?: string;
  exchangeName?: string;
  points: StockPoint[];
};
