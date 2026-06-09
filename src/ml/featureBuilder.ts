import featureCols from '../assets/feature_cols.json';

export type PriceBar = {
  date: string | number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  dividends?: number;
  stock_splits?: number;
  capital_gains?: number;
};

export type FundamentalInfo = {
  marketCap?: number;
  enterpriseValue?: number;
  currentPrice?: number;
  targetMeanPrice?: number;
  targetMedianPrice?: number;
  recommendationMean?: number;
  numberOfAnalystOpinions?: number;
  beta?: number;
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  bookValue?: number;
  trailingEps?: number;
  forwardEps?: number;
  pegRatio?: number;
  dividendYield?: number;
  payoutRatio?: number;
  returnOnAssets?: number;
  returnOnEquity?: number;
  grossMargins?: number;
  operatingMargins?: number;
  ebitdaMargins?: number;
  profitMargins?: number;
  freeCashflow?: number;
  operatingCashflow?: number;
  totalCash?: number;
  totalDebt?: number;
  debtToEquity?: number;
  currentRatio?: number;
  quickRatio?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  earningsQuarterlyGrowth?: number;
  totalRevenue?: number;
  ebitda?: number;
  grossProfits?: number;
  sharesOutstanding?: number;
  floatShares?: number;
  heldPercentInstitutions?: number;
  heldPercentInsiders?: number;
  shortRatio?: number;
  shortPercentOfFloat?: number;
  ['52WeekChange']?: number;
  SandP52WeekChange?: number;
};

function toFinite(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pctChange(current: number, prev: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(prev) || prev === 0) return 0;
  return current / prev - 1;
}
function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function std(values: number[]): number {
  if (!values.length) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}
function lastN(values: number[], n: number): number[] {
  if (values.length < n) return [];
  return values.slice(values.length - n);
}
function rollingMean(values: number[], n: number): number {
  return mean(lastN(values, n));
}
function rollingMax(values: number[], n: number): number {
  const arr = lastN(values, n);
  return arr.length ? Math.max(...arr) : 0;
}
function rollingMin(values: number[], n: number): number {
  const arr = lastN(values, n);
  return arr.length ? Math.min(...arr) : 0;
}

export function buildFeatureMap(history: PriceBar[], info: FundamentalInfo): Record<string, number> {
  const rows = [...history]
    .filter(item => Number.isFinite(Number(item.close)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const opens = rows.map(r => toFinite(r.open));
  const highs = rows.map(r => toFinite(r.high ?? r.close));
  const lows = rows.map(r => toFinite(r.low ?? r.close));
  const closes = rows.map(r => toFinite(r.close));
  const volumes = rows.map(r => toFinite(r.volume));
  const dividends = rows.map(r => toFinite(r.dividends));
  const stockSplits = rows.map(r => toFinite(r.stock_splits));
  const capitalGains = rows.map(r => toFinite(r.capital_gains));
  const ret1dSeries = closes.map((close, i) => (i === 0 ? 0 : pctChange(close, closes[i - 1])));
  const lastClose = closes.at(-1) ?? 0;
  const ma20 = rollingMean(closes, 20);
  const ma60 = rollingMean(closes, 60);
  const ma120 = rollingMean(closes, 120);
  const high252 = rollingMax(highs, 252);
  const low252 = rollingMin(lows, 252);
  const dollarVolumes = closes.map((close, i) => close * toFinite(volumes[i]));

  return {
    open: opens.at(-1) ?? 0,
    high: highs.at(-1) ?? 0,
    low: lows.at(-1) ?? 0,
    close: lastClose,
    volume: volumes.at(-1) ?? 0,
    dividends: dividends.at(-1) ?? 0,
    stock_splits: stockSplits.at(-1) ?? 0,
    ret_1d: ret1dSeries.at(-1) ?? 0,
    ret_5d: closes.length > 5 ? pctChange(lastClose, closes[closes.length - 6]) : 0,
    ret_21d: closes.length > 21 ? pctChange(lastClose, closes[closes.length - 22]) : 0,
    ret_63d: closes.length > 63 ? pctChange(lastClose, closes[closes.length - 64]) : 0,
    ret_126d: closes.length > 126 ? pctChange(lastClose, closes[closes.length - 127]) : 0,
    ret_252d: closes.length > 252 ? pctChange(lastClose, closes[closes.length - 253]) : 0,
    vol_21d: std(lastN(ret1dSeries, 21)),
    vol_63d: std(lastN(ret1dSeries, 63)),
    ma_20: ma20,
    price_to_ma20: ma20 === 0 ? 0 : lastClose / ma20,
    ma_60: ma60,
    price_to_ma60: ma60 === 0 ? 0 : lastClose / ma60,
    ma_120: ma120,
    price_to_ma120: ma120 === 0 ? 0 : lastClose / ma120,
    high_252_max: high252,
    low_252_min: low252,
    pct_from_52w_high: high252 === 0 ? 0 : lastClose / high252 - 1,
    pct_from_52w_low: low252 === 0 ? 0 : lastClose / low252 - 1,
    dollar_volume: dollarVolumes.at(-1) ?? 0,
    avg_dollar_volume_21d: rollingMean(dollarVolumes, 21),
    capital_gains: capitalGains.at(-1) ?? 0,
    marketCap: Number(info.marketCap ?? 0),
    enterpriseValue: Number(info.enterpriseValue ?? 0),
    currentPrice: Number(info.currentPrice ?? 0),
    targetMeanPrice: Number(info.targetMeanPrice ?? 0),
    targetMedianPrice: Number(info.targetMedianPrice ?? 0),
    recommendationMean: Number(info.recommendationMean ?? 0),
    numberOfAnalystOpinions: Number(info.numberOfAnalystOpinions ?? 0),
    beta: Number(info.beta ?? 0),
    trailingPE: Number(info.trailingPE ?? 0),
    forwardPE: Number(info.forwardPE ?? 0),
    priceToBook: Number(info.priceToBook ?? 0),
    bookValue: Number(info.bookValue ?? 0),
    trailingEps: Number(info.trailingEps ?? 0),
    forwardEps: Number(info.forwardEps ?? 0),
    pegRatio: Number(info.pegRatio ?? 0),
    dividendYield: Number(info.dividendYield ?? 0),
    payoutRatio: Number(info.payoutRatio ?? 0),
    returnOnAssets: Number(info.returnOnAssets ?? 0),
    returnOnEquity: Number(info.returnOnEquity ?? 0),
    grossMargins: Number(info.grossMargins ?? 0),
    operatingMargins: Number(info.operatingMargins ?? 0),
    ebitdaMargins: Number(info.ebitdaMargins ?? 0),
    profitMargins: Number(info.profitMargins ?? 0),
    freeCashflow: Number(info.freeCashflow ?? 0),
    operatingCashflow: Number(info.operatingCashflow ?? 0),
    totalCash: Number(info.totalCash ?? 0),
    totalDebt: Number(info.totalDebt ?? 0),
    debtToEquity: Number(info.debtToEquity ?? 0),
    currentRatio: Number(info.currentRatio ?? 0),
    quickRatio: Number(info.quickRatio ?? 0),
    revenueGrowth: Number(info.revenueGrowth ?? 0),
    earningsGrowth: Number(info.earningsGrowth ?? 0),
    earningsQuarterlyGrowth: Number(info.earningsQuarterlyGrowth ?? 0),
    totalRevenue: Number(info.totalRevenue ?? 0),
    ebitda: Number(info.ebitda ?? 0),
    grossProfits: Number(info.grossProfits ?? 0),
    sharesOutstanding: Number(info.sharesOutstanding ?? 0),
    floatShares: Number(info.floatShares ?? 0),
    heldPercentInstitutions: Number(info.heldPercentInstitutions ?? 0),
    heldPercentInsiders: Number(info.heldPercentInsiders ?? 0),
    shortRatio: Number(info.shortRatio ?? 0),
    shortPercentOfFloat: Number(info.shortPercentOfFloat ?? 0),
    ['52WeekChange']: Number(info['52WeekChange'] ?? 0),
    SandP52WeekChange: Number(info.SandP52WeekChange ?? 0),
  };
}

export function buildModelInput(history: PriceBar[], info: FundamentalInfo): Float32Array {
  const featureMap = buildFeatureMap(history, info);
  return new Float32Array((featureCols as string[]).map(col => toFinite(featureMap[col])));
}
