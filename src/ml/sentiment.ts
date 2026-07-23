/**
 * On-device sentiment scoring for StockApp.
 * Uses the Phase-1 Financial PhraseBank TFLite model + Yahoo Finance search news.
 *
 * Assets required (place next to us_market_model.tflite):
 *   - sentiment.tflite
 *   - sentiment_vocab.json   // string[] of tokens, index 0="", 1="[UNK]", ...
 *
 * Convert from training output:
 *   python -c "
 * from pathlib import Path
 * lines = Path('output/sentiment_model/vectorizer_vocab.txt').read_text().splitlines()
 * import json; Path('src/assets/sentiment_vocab.json').write_text(json.dumps(lines))
 * "
 * then copy output/sentiment_model/sentiment.tflite → src/assets/
 */

import {loadTensorflowModel} from 'react-native-fast-tflite';

const MAX_LEN = 64;
const UNK_ID = 1; // convention from Keras TextVectorization

export type SentimentFeatures = {
  sentiment_score: number;
  sentiment_ma_7d: number;
  news_count_7d: number;
};

const ZERO: SentimentFeatures = {
  sentiment_score: 0,
  sentiment_ma_7d: 0,
  news_count_7d: 0,
};

let vocab: string[] | null = null;
let vocabMap: Map<string, number> | null = null;
let sentimentModel: any = null;
let modelLoadFailed = false;

async function ensureVocab(): Promise<Map<string, number> | null> {
  if (vocabMap) return vocabMap;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require('../assets/sentiment_vocab.json');
    vocab = Array.isArray(raw) ? raw : [];
    vocabMap = new Map();
    vocab.forEach((tok, i) => vocabMap!.set(String(tok).toLowerCase(), i));
    return vocabMap;
  } catch (e) {
    console.warn('[sentiment] vocab missing → features stay 0. Add src/assets/sentiment_vocab.json');
    return null;
  }
}

async function ensureModel() {
  if (sentimentModel || modelLoadFailed) return sentimentModel;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('../assets/sentiment.tflite');
    sentimentModel = await loadTensorflowModel(path, []);
    return sentimentModel;
  } catch (e) {
    console.warn('[sentiment] model missing or load failed → features stay 0');
    modelLoadFailed = true;
    return null;
  }
}

function tokenize(text: string, map: Map<string, number>): Int32Array {
  // Match training build_sentiment_daily_example.py as closely as possible
  const cleaned = text
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/,/g, ' ')
    .replace(/[^\w\s]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const ids = tokens.map(t => map.get(t) ?? UNK_ID);
  const padded = ids.slice(0, MAX_LEN);
  while (padded.length < MAX_LEN) padded.push(0);
  return Int32Array.from(padded);
}

async function scoreTexts(texts: string[]): Promise<number[]> {
  if (!texts.length) return [];
  const map = await ensureVocab();
  const model = await ensureModel();
  if (!map || !model) return texts.map(() => 0);

  const scores: number[] = [];
  for (const t of texts) {
    try {
      const ids = tokenize(t, map);
      // fast-tflite expects ArrayBuffer-like; shape [1, 64]
      const input = new Int32Array(ids);
      const output = await model.run([input.buffer]);
      const probs = output?.[0] ? new Float32Array(output[0]) : new Float32Array(3);
      // P_pos - P_neg  (indices 2 - 0)
      const score = Number(probs[2] ?? 0) - Number(probs[0] ?? 0);
      scores.push(Number.isFinite(score) ? score : 0);
    } catch {
      scores.push(0);
    }
  }
  return scores;
}

type YahooNewsItem = {
  title?: string;
  providerPublishTime?: number;
  relatedTickers?: string[];
  publisher?: string;
};

async function fetchYahooNews(symbol: string, count = 25): Promise<YahooNewsItem[]> {
  const cleaned = symbol.trim().toUpperCase();
  if (!cleaned) return [];

  const url =
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(cleaned)}` +
    `&quotesCount=0&newsCount=${count}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });
    if (!response.ok) {
      console.warn(`[sentiment] news HTTP ${response.status}`);
      return [];
    }
    const json = await response.json();
    const news: YahooNewsItem[] = json?.news ?? [];
    return Array.isArray(news) ? news : [];
  } catch (e) {
    console.warn('[sentiment] news fetch failed', e);
    return [];
  }
}

/**
 * Compute the three sentiment features expected by the main model.
 * Uses last ~7 calendar days of Yahoo news titles scored by the on-device TFLite model.
 */
export async function computeSentimentFeatures(
  symbol: string,
): Promise<SentimentFeatures> {
  try {
    const items = await fetchYahooNews(symbol, 30);
    if (!items.length) return {...ZERO};

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const upper = symbol.trim().toUpperCase();

    const recent = items.filter(item => {
      const ts = Number(item.providerPublishTime);
      if (!Number.isFinite(ts)) return false;
      const age = now - ts * 1000;
      if (age < 0 || age > sevenDaysMs) return false;
      // Prefer articles that mention the ticker; keep others if few results
      const related = (item.relatedTickers ?? []).map(t => String(t).toUpperCase());
      if (related.length && !related.includes(upper)) return false;
      return Boolean(item.title && item.title.trim());
    });

    // Fallback: if filter too strict, use all recent titles
    const pool = recent.length >= 3 ? recent : items.filter(item => {
      const ts = Number(item.providerPublishTime);
      if (!Number.isFinite(ts)) return false;
      const age = now - ts * 1000;
      return age >= 0 && age <= sevenDaysMs && Boolean(item.title?.trim());
    });

    if (!pool.length) return {...ZERO};

    const titles = pool.map(i => (i.title || '').trim()).filter(Boolean);
    const scores = await scoreTexts(titles);
    const valid = scores.filter(s => Number.isFinite(s));
    if (!valid.length) return {...ZERO};

    const mean =
      valid.reduce((a, b) => a + b, 0) / valid.length;

    // For a single “now” prediction we approximate:
    // sentiment_score ≈ latest / mean of recent
    // sentiment_ma_7d ≈ same mean (no daily history on device)
    // news_count_7d = number of scored articles in window
    return {
      sentiment_score: mean,
      sentiment_ma_7d: mean,
      news_count_7d: valid.length,
    };
  } catch (e) {
    console.warn('[sentiment] compute failed', e);
    return {...ZERO};
  }
}
