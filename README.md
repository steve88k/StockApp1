# StockApp1

React Native + TFLite stock rise-probability app.

Predicts the probability that a US stock will rise ≥ 10% / 20% / 30% over the next 3 / 6 / 9 / 12 months.  
All inference runs on-device. Live Yahoo data supplies prices, fundamentals, and recent news titles; the models and scaler stay on the device.

---

## Features

- **Multi-horizon / multi-threshold model**  
  12 outputs in one forward pass:
  - Horizons: 3m · 6m · 9m · 12m (≈ 63 / 126 / 189 / 252 trading days)
  - Thresholds: ≥10% · ≥20% · ≥30%

- **Price features**  
  2 years of daily bars from the Yahoo chart API → returns, volatility, moving averages, 52-week position, dollar volume.

- **Fundamentals**  
  Yahoo `quoteSummary` via cookie + crumb (same field names as yfinance `Ticker.info`). Fail-soft: if auth or the network fails, those inputs are `0` and prediction still runs. Crumb is cached ~55 minutes; per-ticker fundamentals are cached 6 hours.

- **On-device sentiment**  
  Fetches recent Yahoo news → scores titles with `sentiment.tflite` → feeds 3 features into the main model:
  - `sentiment_score` (P_pos − P_neg, ≈ −1 ~ +1)
  - `sentiment_ma_7d` (same average in the app; not a true historical 7-day MA)
  - `news_count_7d`

- **Result card**  
  Probability, BUY / HOLD / AVOID, and a one-line rationale. **What this means** expands an explanation of each rationale segment; tap again to collapse.

- **Chart + favorites**  
  1-year daily chart on Home (display range chips). Favorites persist in AsyncStorage; bottom tabs are Search / Favorites.

---

## Architecture (high level)

```
Yahoo Chart API          ──► 2y daily bars (model) + 1y bars (chart UI)
Yahoo quoteSummary       ──► ~44 fundamental fields (cookie + crumb)
Yahoo Search API         ──► news titles (last ~7 days)
                                 │
                                 ▼
                      sentiment.tflite  →  sentiment_score / ma_7d / news_count_7d
                                 │
                                 ▼
                      featureBuilder (75 features)
                                 │
                                 ▼
                      StandardScaler (scaler.json)
                                 │
                                 ▼
                      us_market_model.tflite  →  12 probabilities
                                 │
                                 ▼
                      App selects one head by horizon + growth
                      BUY if p ≥ thr+0.1, HOLD if p ≥ thr, else AVOID
```

A search waits for prediction (history + fundamentals + sentiment) and the chart request in parallel. The spinner lasts until the slowest of those finishes.

---

## What goes into the model

75 features, in `feature_cols.json` order:

| Group | Status | Notes |
|---|---|---|
| Price / volume / returns / MAs / 52-week | Live | From 2y daily chart |
| `dividends`, `stock_splits`, `capital_gains` | Always 0 | Chart parser does not read Yahoo events |
| Fundamentals (P/E, margins, targets, …) | Live, fail-soft | `getInfo` → `yahooFundamentals.ts` |
| Sentiment (3 cols) | Live, fail-soft | Last ~7 days of titles only |

`currentPrice` falls back to the last close if quoteSummary omits it.

Typical `sentiment 0.01–0.09` with `N news` is normal: most headlines score near neutral, and the app averages them. `sentiment=0 (0 news)` means no titles or the sentiment model did not load.

---

## Project structure

```
src/
├── assets/
│   ├── us_market_model.tflite      # main multi-output MLP
│   ├── sentiment.tflite            # Phase-1 news sentiment model
│   ├── sentiment_vocab.json        # tokenizer vocab
│   ├── scaler.json
│   ├── feature_cols.json           # 75 feature names (order matters)
│   └── output_cols.json            # 12 output heads + index map
├── ml/
│   ├── featureBuilder.ts           # price + fundamental + sentiment features
│   ├── prediction.ts               # TFLite runner + head selection
│   ├── scaler.ts
│   └── sentiment.ts                # Yahoo news + on-device scoring
├── services/
│   ├── stockApi.ts                 # chart, prediction orchestration, thresholds
│   ├── yahooFundamentals.ts        # cookie + crumb + quoteSummary
│   └── favoritesStorage.ts
├── screens/
│   ├── HomeScreen.tsx
│   └── FavoritesScreen.tsx
├── components/
│   └── ResultCard.tsx              # probability + expandable rationale
└── types/
```

---

## Setup

### Requirements
- Node ≥ 22.11
- React Native CLI environment (Android Studio / Xcode)
- Android device or emulator (tested path)

### Install & run

```bash
npm install
npm start
# another terminal
npm run android
```

### Required model assets

These files must exist under `src/assets/` (and preferably also under `android/app/src/main/assets/` for release builds):

| File | Source |
|------|--------|
| `us_market_model.tflite` | Training pipeline output |
| `scaler.json` | Training pipeline output |
| `feature_cols.json` | Training pipeline output |
| `output_cols.json` | Training pipeline output |
| `sentiment.tflite` | `output/sentiment_model/sentiment.tflite` |
| `sentiment_vocab.json` | Converted from `vectorizer_vocab.txt` |

---

## Model details

### Main model (`us_market_model.tflite`)
- Input shape: `[1, 75]` (float32, standardized)
- Output shape: `[1, 12]` (sigmoid probabilities)
- Architecture: MLP (Dense 256 → 128 → 12)
- Features include returns, moving averages, volatility, fundamentals, and the 3 sentiment columns

### Sentiment model (`sentiment.tflite`)
- Input: tokenized title → int32 ids of length 64
- Output: 3-class softmax `[neg, neu, pos]`
- Score used by the app: `P_pos − P_neg` (≈ −1 ~ +1)
- Trained on Financial PhraseBank (Phase 1)

### Decision thresholds
Hard-coded in `stockApi.ts` (best-F1 values from validation):

| Head | thr | Head | thr |
|---|---|---|---|
| `y_3m_10` | 0.29 | `y_9m_10` | 0.28 |
| `y_3m_20` | 0.24 | `y_9m_20` | 0.24 |
| `y_3m_30` | 0.24 | `y_9m_30` | 0.25 |
| `y_6m_10` | 0.27 | `y_12m_10` | 0.28 |
| `y_6m_20` | 0.27 | `y_12m_20` | 0.25 |
| `y_6m_30` | 0.24 | `y_12m_30` | 0.25 |

Decision: **BUY** if `p ≥ thr + 0.10`, **HOLD** if `p ≥ thr`, otherwise **AVOID**.

---

## App usage

1. Enter a US ticker (e.g. `AAPL`, `NVDA`)
2. Choose horizon (3m / 6m / 9m / 12m) and growth target (10 / 20 / 30 %)
3. The app fetches 2y prices, fundamentals, and recent news, runs both TFLite models, and shows:
   - Probability
   - Decision: BUY / HOLD / AVOID
   - Rationale, e.g. `≥30% in 12m | TFLite on 503 daily bars | sentiment 0.07 (8 news) | fundamentals 41`
4. Tap **What this means** on the result card to expand each rationale part
5. Add to Favorites for a later re-check (tap a favorite to search it again)

---

## Training side (reference)

The models are produced by a separate Python pipeline (not in this repo):

```
train_sentiment_phase1.py          # → sentiment.tflite + vocab
build_sentiment_daily_example.py   # optional historical sentiment parquet
pipeline_us_market_02_06.py        # features → split → train → validate → threshold
```

App only consumes the exported TFLite + JSON artifacts.

---

## Notes & limitations

- Sentiment is approximated from the last ~7 days of Yahoo search titles. It is not a full daily time series like the training pipeline. `sentiment_score` and `sentiment_ma_7d` are the same mean in the app.
- The last three scaler columns (`sentiment_*`) are identity (`mean = 0`, `scale = 1`), so a score of 0.05 enters the main model as 0.05 — a small input.
- If `sentiment.tflite` or the vocab is missing, or news fetch fails, the three sentiment features fall back to `0`.
- Fundamentals use unofficial Yahoo `quoteSummary` and need a cookie + crumb. Quote/quoteSummary return 401 without that handshake; the chart API is still more open.
- React Native `fetch` may not expose `Set-Cookie`. If the rationale stays at `fundamentals=0` while a desktop session can fetch the same API, the cookie header is likely blocked.
- Yahoo may rate-limit (429). `getInfo` then returns `{}` and does not fail the prediction.
- Yahoo endpoints are unofficial and may change.

---

## License

Private / personal project.
