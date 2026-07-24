# StockApp1

React Native + TFLite offline stock rise-probability app.

Predicts the probability that a US stock will rise ≥ 10% / 20% / 30% over the next 3 / 6 / 9 / 12 months.  
All inference runs on-device. Sentiment is computed from recent Yahoo Finance news titles using a separate TFLite model.

---

## Features

- **Multi-horizon / multi-threshold model**  
  12 outputs in one forward pass:
  - Horizons: 3m · 6m · 9m · 12m (≈ 63 / 126 / 189 / 252 trading days)
  - Thresholds: ≥10% · ≥20% · ≥30%

- **On-device sentiment**  
  Fetches recent Yahoo news → scores titles with `sentiment.tflite` → feeds 3 features into the main model:
  - `sentiment_score` (P_pos − P_neg)
  - `sentiment_ma_7d`
  - `news_count_7d`

- **Favorites**  
  Local storage via AsyncStorage, bottom-tab navigation (Home / Favorites).

- **Offline-first inference**  
  Price history is fetched live (Yahoo chart API); model + scaler + sentiment model stay on device.

---

## Architecture (high level)

```
Yahoo Chart API ──► Price bars (2y daily)
Yahoo Search API ──► News titles (last ~7 days)
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
              App selects one head by horizon + growth chips
```

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
│   ├── stockApi.ts                 # Yahoo data + prediction orchestration
│   └── favoritesStorage.ts
├── screens/
│   ├── HomeScreen.tsx
│   └── FavoritesScreen.tsx
├── components/
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

Convert vocab once:

```bash
python -c "
from pathlib import Path
import json
lines = Path('output/sentiment_model/vectorizer_vocab.txt').read_text(encoding='utf-8').splitlines()
Path('src/assets/sentiment_vocab.json').write_text(json.dumps(lines), encoding='utf-8')
print('vocab written, size =', len(lines))
"
cp output/sentiment_model/sentiment.tflite src/assets/
```

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
Hard-coded in `stockApi.ts` (best-F1 values from validation).  
Example: for `y_12m_30` the threshold is currently `0.11`.

---

## App usage

1. Enter a US ticker (e.g. `AAPL`, `NVDA`)
2. Choose horizon (3m / 6m / 9m / 12m) and growth target (10 / 20 / 30 %)
3. The app fetches price history + recent news, runs both TFLite models, and shows:
   - Probability
   - Decision: BUY / HOLD / AVOID
   - Short rationale including sentiment score and news count
4. Add to Favorites for quick re-check later

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

- Sentiment is approximated on-device from the last ~7 days of Yahoo search news. It is not a full daily time-series like the training pipeline.
- If `sentiment.tflite` or the vocab is missing, or network fails, the three sentiment features fall back to `0` and the main model still runs.
- Fundamentals (`getInfo`) are currently stubbed; the model relies mainly on price-derived features + sentiment.
- Yahoo endpoints are unofficial and may change or rate-limit.

---

## License

Private / personal project.
