#!/usr/bin/env python3
"""
Offline experiment: CNN + LSTM multi-output vs current tabular MLP

Goal
----
Use existing raw daily OHLCV + already-computed multi-horizon labels
to train a sequence model and measure whether it beats the current
MLP on the same 12-target task.

Confirmed from user:
  1. Raw path structure: data/us_market/raw/{TICKER}_history.parquet
  2. Labels already exist → we load them (no recompute)
  3. Include sentiment as a 5th channel

Usage
-----
  # 1. Make sure you have:
  #    - data/us_market/raw/{TICKER}_history.parquet
  #    - data/us_market/us_ticker_universe.csv
  #    - (optional) data/us_market/sentiment_daily.parquet
  #    - Existing features with labels (train_parts / features_panel / or we can
  #      fall back to computing labels with the same logic as pipeline)

  python experiment_cnn_lstm_sequence.py --lookback 60 --epochs 30

  # Faster smoke test on a few tickers:
  python experiment_cnn_lstm_sequence.py --max-tickers 50 --lookback 60 --epochs 5

Output
------
  output/cnn_lstm_experiment/
    model.keras
    history.json
    metrics.json
    sample_predictions.parquet
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from tensorflow import keras
from tensorflow.keras import layers

# =============================================================================
# Paths & constants (keep identical to pipeline_us_market_02_06.py)
# =============================================================================
ROOT = Path("data/us_market")
RAW = ROOT / "raw"
TRAIN_DIR = ROOT / "train_parts"
VALID_DIR = ROOT / "valid_parts"
PART_DIR = ROOT / "features_panel_parts"
SENTIMENT_DAILY = ROOT / "sentiment_daily.parquet"
UNIVERSE = ROOT / "us_ticker_universe.csv"
OUT = Path("output/cnn_lstm_experiment")

HORIZONS = {"3m": 63, "6m": 126, "9m": 189, "12m": 252}
THRESHOLDS = {"10": 0.10, "20": 0.20, "30": 0.30}
OUTPUT_COLS = [
    f"y_{h}_{t}"
    for h in ["3m", "6m", "9m", "12m"]
    for t in ["10", "20", "30"]
]

TRAIN_START = "2020-04-01"
TRAIN_END = "2025-03-31"
VALID_START = "2025-04-01"
VALID_END = "2026-03-31"

# Sequence config (first experiment)
DEFAULT_LOOKBACK = 60
CHANNELS = [
    "log_ret",
    "high_rel",      # (high - close) / close
    "low_rel",       # (close - low) / close
    "log_vol",
    "sentiment",     # daily sentiment_score (0 if missing)
]
N_CHANNELS = len(CHANNELS)


# =============================================================================
# Helpers
# =============================================================================
def ensure_out() -> None:
    OUT.mkdir(parents=True, exist_ok=True)


def load_sentiment_map() -> dict[str, pd.DataFrame]:
    """ticker -> DataFrame indexed by date with sentiment_score."""
    if not SENTIMENT_DAILY.exists():
        print(f"[sentiment] {SENTIMENT_DAILY} not found → all zeros")
        return {}
    s = pd.read_parquet(SENTIMENT_DAILY)
    s["date"] = pd.to_datetime(s["date"]).dt.tz_localize(None)
    s["ticker"] = s["ticker"].astype(str).str.upper()
    if "sentiment_score" not in s.columns:
        raise ValueError("sentiment_daily.parquet must contain sentiment_score")
    out = {}
    for t, g in s.groupby("ticker"):
        g = g.sort_values("date").drop_duplicates("date", keep="last")
        out[t] = g.set_index("date")[["sentiment_score"]]
    print(f"[sentiment] loaded {len(out)} tickers")
    return out


def load_existing_labels() -> Optional[pd.DataFrame]:
    """
    Prefer existing labels so we do NOT recompute them.
    Tries train_parts + valid_parts first, then features_panel_parts.
    Returns DataFrame with at least: ticker, date, + OUTPUT_COLS
    """
    frames = []

    for d in (TRAIN_DIR, VALID_DIR):
        if d.exists():
            for p in sorted(d.glob("*.parquet")):
                try:
                    df = pd.read_parquet(p, columns=["ticker", "date"] + OUTPUT_COLS)
                    frames.append(df)
                except Exception:
                    # some parts may miss columns; try full read
                    try:
                        df = pd.read_parquet(p)
                        cols = ["ticker", "date"] + [c for c in OUTPUT_COLS if c in df.columns]
                        frames.append(df[cols])
                    except Exception:
                        pass

    if not frames and PART_DIR.exists():
        for p in sorted(PART_DIR.glob("features_part_*.parquet")):
            try:
                df = pd.read_parquet(p)
                cols = ["ticker", "date"] + [c for c in OUTPUT_COLS if c in df.columns]
                if len(cols) >= 3:
                    frames.append(df[cols])
            except Exception:
                pass

    if not frames:
        return None

    labels = pd.concat(frames, ignore_index=True)
    labels["date"] = pd.to_datetime(labels["date"]).dt.tz_localize(None)
    labels["ticker"] = labels["ticker"].astype(str).str.upper()
    labels = labels.drop_duplicates(subset=["ticker", "date"], keep="last")
    labels = labels.dropna(subset=OUTPUT_COLS)
    print(f"[labels] loaded {len(labels):,} rows with complete 12 labels "
          f"from existing parts")
    return labels


def make_labels_from_history(df: pd.DataFrame) -> pd.DataFrame:
    """Fallback only: same logic as pipeline make_price_features (labels part)."""
    df = df.copy()
    df = df.sort_values("date")
    for h_name, h_days in HORIZONS.items():
        fwd = df["close"].shift(-h_days) / df["close"] - 1
        for t_name, t_val in THRESHOLDS.items():
            col = f"y_{h_name}_{t_name}"
            df[col] = (fwd >= t_val).astype(float)
            df.loc[fwd.isna(), col] = np.nan
    return df


def build_channels(window: pd.DataFrame, sentiment_series: Optional[pd.Series]) -> np.ndarray:
    """
    window: DataFrame of length LOOKBACK, sorted by date, columns open/high/low/close/volume
    Returns shape (LOOKBACK, N_CHANNELS)
    """
    close = window["close"].astype(float).values
    high = window["high"].astype(float).values
    low = window["low"].astype(float).values
    vol = window["volume"].astype(float).values

    # avoid div0
    close_safe = np.where(close == 0, 1e-8, close)

    log_ret = np.zeros_like(close)
    log_ret[1:] = np.log(close[1:] / np.maximum(close[:-1], 1e-8))
    high_rel = (high - close) / close_safe
    low_rel = (close - low) / close_safe
    log_vol = np.log(np.maximum(vol, 0) + 1.0)

    # sentiment: align by date if possible, else 0
    sent = np.zeros(len(window), dtype=np.float32)
    if sentiment_series is not None and not sentiment_series.empty:
        # reindex to window dates
        aligned = sentiment_series.reindex(window["date"].values).fillna(0.0)
        sent = aligned.values.astype(np.float32)

    channels = np.stack([log_ret, high_rel, low_rel, log_vol, sent], axis=-1)
    # simple per-window standardization for price-related channels (exclude sentiment)
    for i in range(4):
        col = channels[:, i]
        std = col.std()
        if std > 1e-6:
            channels[:, i] = (col - col.mean()) / std
        else:
            channels[:, i] = 0.0
    return channels.astype(np.float32)


def build_sequences_for_ticker(
    ticker: str,
    labels_for_ticker: pd.DataFrame,
    lookback: int,
    sentiment_map: dict,
) -> tuple[list[np.ndarray], list[np.ndarray], list[pd.Timestamp]]:
    """
    Returns lists of X (lookback, C), y (12,), and the end dates.
    Only windows that have full lookback history and complete labels.
    """
    hist_path = RAW / f"{ticker}_history.parquet"
    if not hist_path.exists():
        return [], [], []

    try:
        hist = pd.read_parquet(hist_path)
    except Exception as e:
        print(f"  [skip] {ticker} read error: {e}")
        return [], [], []

    # normalize columns
    hist.columns = [c.lower() for c in hist.columns]
    required = {"date", "open", "high", "low", "close", "volume"}
    if not required.issubset(set(hist.columns)):
        # try common alternatives
        if "adj close" in hist.columns and "close" not in hist.columns:
            hist = hist.rename(columns={"adj close": "close"})
        if not required.issubset(set(hist.columns)):
            return [], [], []

    hist["date"] = pd.to_datetime(hist["date"]).dt.tz_localize(None)
    hist = hist.sort_values("date").drop_duplicates("date", keep="last").reset_index(drop=True)

    if len(hist) < lookback + 5:
        return [], [], []

    # sentiment series for this ticker
    sent_panel = sentiment_map.get(ticker.upper())
    if sent_panel is not None:
        sent_series = sent_panel["sentiment_score"]
    else:
        sent_series = None

    # labels indexed by date
    lab = labels_for_ticker.set_index("date").sort_index()
    lab = lab[~lab.index.duplicated(keep="last")]

    Xs, ys, dates = [], [], []
    # we iterate over dates that have labels
    for end_date, row in lab.iterrows():
        # find position in history
        idx = hist.index[hist["date"] == end_date]
        if len(idx) == 0:
            continue
        pos = idx[0]
        start = pos - lookback + 1
        if start < 0:
            continue
        window = hist.iloc[start : pos + 1]
        if len(window) != lookback:
            continue
        # all labels must be present (already filtered, but double-check)
        y_vals = row[OUTPUT_COLS].values.astype(np.float32)
        if np.any(np.isnan(y_vals)):
            continue

        x = build_channels(window, sent_series)
        Xs.append(x)
        ys.append(y_vals)
        dates.append(end_date)

    return Xs, ys, dates


def collect_dataset(
    lookback: int,
    max_tickers: Optional[int] = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Returns X_train, y_train, X_valid, y_valid
    """
    labels = load_existing_labels()
    if labels is None:
        print("[warn] No existing label parts found. Falling back to computing labels "
              "from history (same formula as pipeline).")
        # fallback path would require computing per ticker – keep simple for now
        raise FileNotFoundError(
            "Please run the features / split stages of pipeline_us_market_02_06.py first "
            "so that train_parts / valid_parts (or features_panel_parts) exist with the "
            "12 label columns. This guarantees identical labels to your MLP baseline."
        )

    sentiment_map = load_sentiment_map()

    # restrict to tickers that appear in labels
    tickers = sorted(labels["ticker"].unique())
    if max_tickers is not None:
        tickers = tickers[:max_tickers]
        labels = labels[labels["ticker"].isin(tickers)]

    print(f"[data] building sequences for {len(tickers)} tickers, lookback={lookback}")

    all_X, all_y, all_dates, all_tickers = [], [], [], []

    for i, ticker in enumerate(tickers, 1):
        lab_t = labels[labels["ticker"] == ticker]
        Xs, ys, dates = build_sequences_for_ticker(
            ticker, lab_t, lookback, sentiment_map
        )
        if Xs:
            all_X.extend(Xs)
            all_y.extend(ys)
            all_dates.extend(dates)
            all_tickers.extend([ticker] * len(Xs))
        if i % 50 == 0 or i == len(tickers):
            print(f"  [{i}/{len(tickers)}] collected so far: {len(all_X):,} sequences")

    if not all_X:
        raise RuntimeError("No sequences could be built. Check raw history files and labels.")

    X = np.stack(all_X, axis=0)
    y = np.stack(all_y, axis=0)
    dates = pd.to_datetime(all_dates)

    # time split
    train_mask = (dates >= TRAIN_START) & (dates <= TRAIN_END)
    valid_mask = (dates >= VALID_START) & (dates <= VALID_END)

    X_train, y_train = X[train_mask], y[train_mask]
    X_valid, y_valid = X[valid_mask], y[valid_mask]

    print(f"[data] X_train={X_train.shape}  y_train={y_train.shape}")
    print(f"[data] X_valid={X_valid.shape}  y_valid={y_valid.shape}")
    print(f"[data] positive rates (train): {y_train.mean(axis=0).round(3)}")

    return X_train, y_train, X_valid, y_valid


# =============================================================================
# Model
# =============================================================================
def build_cnn_lstm(lookback: int, n_channels: int, n_outputs: int = 12) -> keras.Model:
    """Lightweight CNN + LSTM multi-output."""
    inp = keras.Input(shape=(lookback, n_channels), name="sequence")

    x = layers.Conv1D(32, kernel_size=5, padding="same")(inp)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.Dropout(0.15)(x)

    x = layers.Conv1D(64, kernel_size=3, padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.MaxPooling1D(2)(x)
    x = layers.Dropout(0.15)(x)

    # Avoid cuDNN 9.x LSTM bug ("Sequence lengths required").
    # unroll=True is safe here because after MaxPool the sequence length is only 30.
    x = layers.LSTM(64, dropout=0.2, unroll=True)(x)
    x = layers.Dense(64, activation="relu")(x)
    x = layers.Dropout(0.3)(x)

    out = layers.Dense(n_outputs, activation="sigmoid", name="multi_prob")(x)

    model = keras.Model(inp, out, name="cnn_lstm_multi")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=1e-3),
        loss="binary_crossentropy",
        metrics=[keras.metrics.AUC(name="auc", multi_label=True)],
    )
    return model


def evaluate_multi(y_true: np.ndarray, y_prob: np.ndarray) -> dict:
    """Per-head and macro AUC + simple precision at 0.5."""
    results = {}
    aucs = []
    for i, col in enumerate(OUTPUT_COLS):
        try:
            auc = roc_auc_score(y_true[:, i], y_prob[:, i])
        except ValueError:
            auc = float("nan")
        aucs.append(auc)
        pred = (y_prob[:, i] >= 0.5).astype(int)
        tp = ((pred == 1) & (y_true[:, i] == 1)).sum()
        fp = ((pred == 1) & (y_true[:, i] == 0)).sum()
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        results[col] = {"auc": round(float(auc), 4), "precision@0.5": round(float(prec), 4)}

    results["macro_auc"] = round(float(np.nanmean(aucs)), 4)
    return results


# =============================================================================
# Main
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description="CNN+LSTM sequence experiment")
    parser.add_argument("--lookback", type=int, default=DEFAULT_LOOKBACK)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--max-tickers", type=int, default=None,
                        help="Limit number of tickers for a quick smoke test")
    args = parser.parse_args()

    ensure_out()
    print("=" * 60)
    print("CNN + LSTM multi-output experiment")
    print(f"lookback={args.lookback}  channels={CHANNELS}")
    print(f"outputs={OUTPUT_COLS}")
    print("=" * 60)

    X_train, y_train, X_valid, y_valid = collect_dataset(
        lookback=args.lookback,
        max_tickers=args.max_tickers,
    )

    model = build_cnn_lstm(args.lookback, N_CHANNELS, n_outputs=len(OUTPUT_COLS))
    model.summary()

    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_auc", mode="max", patience=6, restore_best_weights=True
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_auc", mode="max", factor=0.5, patience=3, min_lr=1e-5
        ),
        keras.callbacks.ModelCheckpoint(
            str(OUT / "model.keras"),
            monitor="val_auc",
            mode="max",
            save_best_only=True,
        ),
    ]

    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_valid, y_valid),
        epochs=args.epochs,
        batch_size=args.batch_size,
        callbacks=callbacks,
        verbose=1,
    )

    # Final evaluation
    y_prob = model.predict(X_valid, batch_size=512)
    metrics = evaluate_multi(y_valid, y_prob)
    print("\n=== Validation metrics ===")
    print(json.dumps(metrics, indent=2, ensure_ascii=False))

    # Save
    (OUT / "history.json").write_text(
        json.dumps({k: [float(x) for x in v] for k, v in history.history.items()}, indent=2),
        encoding="utf-8",
    )
    (OUT / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (OUT / "config.json").write_text(
        json.dumps(
            {
                "lookback": args.lookback,
                "channels": CHANNELS,
                "output_cols": OUTPUT_COLS,
                "train_period": [TRAIN_START, TRAIN_END],
                "valid_period": [VALID_START, VALID_END],
                "n_train": int(len(X_train)),
                "n_valid": int(len(X_valid)),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nSaved to {OUT}/")
    print("Next steps:")
    print("  1. Compare macro_auc / per-horizon AUC with your current MLP")
    print("  2. If better, try --lookback 90 and/or hybrid with fundamentals")
    print("  3. Only after clear lift, consider TFLite conversion")


if __name__ == "__main__":
    main()
