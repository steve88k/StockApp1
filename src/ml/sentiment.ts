/**
 * On-device sentiment scoring for StockApp.
 * Uses the Phase-1 Financial PhraseBank TFLite model + Yahoo Finance search news.
 *
 * Assets required (place next to us_market_model.tflite):
 *   - sentiment.tflite
 *   - sentiment_vocab.json   // string[] of tokens, index 0="", 1="[UNK]", ...
 *
 * Convert from training output (run once):
 *   python -c "
 * from pathlib import Path
 * import json
 * lines = Path('output/sentiment_model/vectorizer_vocab.txt').read_text(encoding='utf-8').splitlines()
 * Path('src/assets/sentiment_vocab.json').write_text(json.dumps(lines), encoding='utf-8')
 * "
 * then copy:
 *   output/sentiment_model/sentiment.tflite  →  src/assets/sentiment.tflite
 */

import {loadTensorflowModel} from 'react-native-fast-tflite';

const MAX_LEN = 64;
const UNK_ID = 1; // Keras TextVectorization: 0 = pad, 1 = [UNK]

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

let vocabMap: Map<string, number> | null = null;
let sentimentModel: any = null;
let modelLoadFailed = false;
let loggedInputOnce = false;

function toArrayBuffer(values: Int32Array | Float32Array): ArrayBuffer {
  return values.buffer.slice(
    values.byteOffset,
    values.byteOffset + values.byteLength,
  ) as ArrayBuffer;
}

async function ensureVocab(): Promise<Map<string, number> | null> {
  if (vocabMap) return vocabMap;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require('../assets/sentiment_vocab.json');
    const list: string[] = Array.isArray(raw) ? raw : [];
    if (list.length < 10) {
      console.warn('[sentiment] vocab too small / empty');
      return null;
    }
    vocabMap = new Map();
    list.forEach((tok, i) => vocabMap!.set(String(tok).toLowerCase(), i));
    console.log(`[sentiment] vocab loaded, size=${list.length}`);
    return vocabMap;
  } catch (e) {
    console.warn(
      '[sentiment] vocab missing → features stay 0. Add src/assets/sentiment_vocab.json',
      e,
    );
    return null;
  }
}

async function ensureModel() {
  if (sentimentModel || modelLoadFailed) return sentimentModel;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('../assets/sentiment.tflite');
    sentimentModel = await loadTensorflowModel(path, []);
    console.log('[sentiment] model loaded OK');
    return sentimentModel;
  } catch (e) {
    console.warn('[sentiment] model missing or load failed → features stay 0', e);
    modelLoadFailed = true;
    return null;
  }
}

/**
 * Approximate Keras TextVectorization (lower + strip punctuation).
 * Keep more tokens than the previous aggressive regex.
 */
function tokenize(text: string, map: Map<string, number>): Int32Array {
  const cleaned = text
    .toLowerCase()
    // keep letters, numbers, apostrophe; turn other punct into space
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned ? cleaned.split(' ') : [];
  const ids: number[] = [];
  for (const t of tokens) {
    if (!t) continue;
    ids.push(map.get(t) ?? UNK_ID);
    if (ids.length >= MAX_LEN) break;
  }
  while (ids.length < MAX_LEN) ids.push(0); // pad
  return Int32Array.from(ids);
}

async function scoreOne(text: string, map: Map<string, number>, model: any): Promise<number> {
  const ids = tokenize(text, map);

  // Debug first call only
  if (!loggedInputOnce) {
    const nonZero = Array.from(ids).filter(x => x !== 0).length;
    const unkCount = Array.from(ids).filter(x => x === UNK_ID).length;
    console.log(
      `[sentiment] sample title="${text.slice(0, 60)}..." nonZero=${nonZero} unk=${unkCount}`,
    );
    loggedInputOnce = true;
  }

  // Try the most common patterns used by react-native-fast-tflite
  const attempts: Array<() => Promise<any>> = [
    // 1. flat Int32Array buffer (same style as main model)
    () => model.run([toArrayBuffer(ids)]),
    // 2. some versions prefer the TypedArray itself
    () => model.run([ids]),
    // 3. force float32 copy (in case converter changed dtype)
    () => model.run([toArrayBuffer(Float32Array.from(ids))]),
  ];

  let lastErr: any = null;
  for (const attempt of attempts) {
    try {
      const output = await attempt();
      const raw = output?.[0] ?? output;
      const probs = new Float32Array(raw);
      if (probs.length < 3) {
        console.warn('[sentiment] unexpected output length', probs.length);
        continue;
      }
      // P_pos - P_neg
      const score = Number(probs[2]) - Number(probs[0]);
      if (!Number.isFinite(score)) continue;
      return Math.max(-1, Math.min(1, score));
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr) {
    console.warn('[sentiment] all run attempts failed:', lastErr?.message || lastErr);
  }
  return 0;
}

async function scoreTexts(texts: string[]): Promise<number[]> {
  if (!texts.length) return [];
  const map = await ensureVocab();
  const model = await ensureModel();
  if (!map || !model) {
    console.warn('[sentiment] map or model missing → all scores 0');
    return texts.map(() => 0);
  }

  const scores: number[] = [];
  for (const t of texts) {
    try {
      scores.push(await scoreOne(t, map, model));
    } catch (e) {
      console.warn('[sentiment] scoreOne error', e);
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

async function fetchYahooNews(
  symbol: string,
  count = 25,
): Promise<YahooNewsItem[]> {
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
    if (!items.length) {
      console.log('[sentiment] no news items');
      return {...ZERO};
    }

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const upper = symbol.trim().toUpperCase();

    const recent = items.filter(item => {
      const ts = Number(item.providerPublishTime);
      if (!Number.isFinite(ts)) return false;
      const age = now - ts * 1000;
      if (age < 0 || age > sevenDaysMs) return false;
      const related = (item.relatedTickers ?? []).map(t =>
        String(t).toUpperCase(),
      );
      if (related.length && !related.includes(upper)) return false;
      return Boolean(item.title && item.title.trim());
    });

    const pool =
      recent.length >= 2
        ? recent
        : items.filter(item => {
            const ts = Number(item.providerPublishTime);
            if (!Number.isFinite(ts)) return false;
            const age = now - ts * 1000;
            return age >= 0 && age <= sevenDaysMs && Boolean(item.title?.trim());
          });

    if (!pool.length) {
      console.log('[sentiment] no news in last 7 days');
      return {...ZERO};
    }

    const titles = pool.map(i => (i.title || '').trim()).filter(Boolean);
    console.log(`[sentiment] scoring ${titles.length} titles for ${upper}`);

    const scores = await scoreTexts(titles);
    const valid = scores.filter(s => Number.isFinite(s));
    if (!valid.length) return {...ZERO};

    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const nonZero = valid.filter(s => Math.abs(s) > 0.02).length;

    console.log(
      `[sentiment] mean=${mean.toFixed(3)} nonZeroScores=${nonZero}/${valid.length}`,
    );

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
