"""
US Market unified pipeline (02-06)
  + Sentiment features
  + Multi-horizon / multi-threshold outputs (App 兩條 bar)

App 選擇：
  時間：3m / 6m / 9m / 12m   （約 63 / 126 / 189 / 252 交易日）
  門檻：10 / 20 / 30 %      （≥ 該漲幅）

模型一次輸出 12 個機率，App 依使用者選擇取對應 index。

Prereq:
  - 01 done: data/us_market/raw/{TICKER}_history.parquet, *_info.json
  - data/us_market/us_ticker_universe.csv
  - optional: data/us_market/sentiment_daily.parquet
  - train_sentiment_phase1.py 獨立（只用於建情緒模型／sentiment_daily）

Usage:
  python pipeline_us_market_02_06.py --stage all
  python pipeline_us_market_02_06.py --stage features
  python pipeline_us_market_02_06.py --stage split
  python pipeline_us_market_02_06.py --stage train
  python pipeline_us_market_02_06.py --stage validate --threshold 0.5
  python pipeline_us_market_02_06.py --stage threshold
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    classification_report,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler
from tensorflow import keras
import tensorflow as tf

# =============================================================================
# Paths
# =============================================================================
ROOT = Path("data/us_market")
RAW = ROOT / "raw"
PART_DIR = ROOT / "features_panel_parts"
TRAIN_DIR = ROOT / "train_parts"
VALID_DIR = ROOT / "valid_parts"
OUT = Path("output/us_market_model")
SENTIMENT_DAILY = ROOT / "sentiment_daily.parquet"
OUT_PANEL = ROOT / "features_panel.parquet"

# =============================================================================
# Multi-target definition（與 App bar 對齊，順序固定）
# =============================================================================
HORIZONS = {
    "3m": 63,
    "6m": 126,
    "9m": 189,
    "12m": 252,
}
THRESHOLDS = {
    "10": 0.10,
    "20": 0.20,
    "30": 0.30,
}

# 固定輸出順序 → App 用同一份 output_cols.json
OUTPUT_COLS = [
    f"y_{h}_{t}"
    for h in ["3m", "6m", "9m", "12m"]
    for t in ["10", "20", "30"]
]
# 例：y_3m_10, y_3m_20, y_3m_30, y_6m_10, ... y_12m_30

FWD_COLS = [f"fwd_ret_{h}" for h in HORIZONS]

SENTIMENT_COLS = ["sentiment_score", "sentiment_ma_7d", "news_count_7d"]

DROP_COLS = (
    ["ticker", "date"]
    + FWD_COLS
    + OUTPUT_COLS
    + ["forward_return", "y_cls_252d"]  # 舊欄位名若殘留也丟掉
)

TRAIN_START = "2020-04-01"
TRAIN_END = "2025-03-31"
VALID_START = "2025-04-01"
VALID_END = "2026-03-31"

PRINT_EVERY = 100
FEAT_BATCH = 100


def ensure_dirs() -> None:
    for p in (PART_DIR, TRAIN_DIR, VALID_DIR, OUT):
        p.mkdir(parents=True, exist_ok=True)


def clean_for_parquet(df: pd.DataFrame) -> pd.DataFrame:
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.replace(["Infinity", "-Infinity", "inf", "-inf", "INF", "-INF"], np.nan)
    for col in df.select_dtypes(include=["object"]).columns.tolist():
        s = df[col]
        sample = s.dropna().astype(str).head(200)
        if len(sample) == 0:
            continue
        ratio = sample.str.match(
            r"^[-+]?((\d+\.?\d*)|(\.\d+))([eE][-+]?\d+)?$"
        ).mean()
        if ratio >= 0.8:
            df[col] = pd.to_numeric(
                s.astype(str).replace(
                    ["Infinity", "-Infinity", "inf", "-inf", "INF", "-INF"], np.nan
                ),
                errors="coerce",
            )
        else:
            df[col] = s.astype("string")
    return df


def get_feature_cols(sample_df: pd.DataFrame) -> list:
    drop = set(DROP_COLS)
    cols = [c for c in sample_df.columns if c not in drop]
    # 排除任何 y_ / fwd_ 殘留
    cols = [c for c in cols if not c.startswith("y_") and not c.startswith("fwd_ret_")]
    base = [c for c in cols if c not in SENTIMENT_COLS]
    sent = [c for c in SENTIMENT_COLS if c in sample_df.columns]
    rest = [c for c in cols if c not in base and c not in sent]
    return base + sent + rest


def make_xy(df: pd.DataFrame, feature_cols: list):
    """X: features；y: (n, 12) multi-label。"""
    X = df[feature_cols].replace([np.inf, -np.inf], np.nan).fillna(0)
    y = df[OUTPUT_COLS].astype(float)
    return X, y


def make_price_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
    df = df.sort_values("date")

    df["ret_1d"] = df["close"].pct_change(1)
    for n in [5, 21, 63, 126, 252]:
        df[f"ret_{n}d"] = df["close"].pct_change(n)
    df["vol_21d"] = df["ret_1d"].rolling(21).std()
    df["vol_63d"] = df["ret_1d"].rolling(63).std()
    for n in [20, 60, 120]:
        df[f"ma_{n}"] = df["close"].rolling(n).mean()
        df[f"price_to_ma{n}"] = df["close"] / df[f"ma_{n}"]
    df["high_252_max"] = df["high"].rolling(252).max()
    df["low_252_min"] = df["low"].rolling(252).min()
    df["pct_from_52w_high"] = df["close"] / df["high_252_max"] - 1
    df["pct_from_52w_low"] = df["close"] / df["low_252_min"] - 1
    df["dollar_volume"] = df["close"] * df["volume"]
    df["avg_dollar_volume_21d"] = df["dollar_volume"].rolling(21).mean()

    # --- 多 horizon × 多 threshold labels ---
    for h_name, h_days in HORIZONS.items():
        fwd = df["close"].shift(-h_days) / df["close"] - 1
        df[f"fwd_ret_{h_name}"] = fwd
        for t_name, t_val in THRESHOLDS.items():
            col = f"y_{h_name}_{t_name}"
            df[col] = (fwd >= t_val).astype(float)
            # 無法計算未來報酬的列保持 NaN（稍後 drop）
            df.loc[fwd.isna(), col] = np.nan

    # 相容舊名（= 12m / 30%）
    df["forward_return"] = df["fwd_ret_12m"]
    df["y_cls_252d"] = df["y_12m_30"]
    return df


def load_sentiment_map() -> dict:
    if not SENTIMENT_DAILY.exists():
        print(f"[features] no {SENTIMENT_DAILY} -> sentiment = 0", flush=True)
        return {}
    s = pd.read_parquet(SENTIMENT_DAILY)
    s["date"] = pd.to_datetime(s["date"]).dt.tz_localize(None)
    s["ticker"] = s["ticker"].astype(str).str.upper()
    if "news_count" not in s.columns:
        s["news_count"] = 1.0
    if "sentiment_score" not in s.columns:
        raise ValueError("sentiment_daily.parquet needs sentiment_score")
    out = {}
    for t, g in s.groupby("ticker"):
        g = g.sort_values("date").drop_duplicates("date", keep="last")
        out[t] = g.set_index("date")[["sentiment_score", "news_count"]]
    print(f"[features] sentiment tickers={len(out)}", flush=True)
    return out


def attach_sentiment(df: pd.DataFrame, ticker: str, sentiment_map: dict) -> pd.DataFrame:
    df = df.copy()
    for c in SENTIMENT_COLS:
        df[c] = 0.0
    panel = sentiment_map.get(ticker.upper())
    if panel is None or panel.empty:
        return df
    left = df.set_index("date")
    right = panel.reindex(left.index)
    score = right["sentiment_score"].fillna(0.0)
    cnt = right["news_count"].fillna(0.0)
    left["sentiment_score"] = score
    left["news_count_7d"] = cnt.rolling(7, min_periods=1).sum()
    left["sentiment_ma_7d"] = score.rolling(7, min_periods=1).mean().fillna(0.0)
    return left.reset_index()


def flush_part(batch_frames, batch_info_rows, part_id: int) -> int:
    if not batch_frames:
        return 0
    part = pd.concat(batch_frames, ignore_index=True)
    if batch_info_rows:
        part = part.merge(pd.DataFrame(batch_info_rows), on="ticker", how="left")
    part = clean_for_parquet(part)
    part.to_parquet(PART_DIR / f"features_part_{part_id:04d}.parquet", index=False)
    return len(part)


def stage_features() -> None:
    ensure_dirs()
    for old in PART_DIR.glob("features_part_*.parquet"):
        old.unlink()

    universe = ROOT / "us_ticker_universe.csv"
    if not universe.exists():
        raise FileNotFoundError(f"missing {universe} (run 01 first)")

    symbols = pd.read_csv(universe)["ticker"].dropna().astype(str).tolist()
    sentiment_map = load_sentiment_map()
    found = missing = errors = part_rows = 0
    batch_frames, batch_info_rows = [], []
    part_id = 1
    total = len(symbols)
    print(f"[features] symbols={total} outputs={OUTPUT_COLS}", flush=True)

    for i, ticker in enumerate(symbols, 1):
        hist_path = RAW / f"{ticker}_history.parquet"
        info_path = RAW / f"{ticker}_info.json"
        if not hist_path.exists():
            missing += 1
            if i % PRINT_EVERY == 0:
                print(
                    f"[features] {i}/{total} found={found} missing={missing} err={errors}",
                    flush=True,
                )
            continue
        try:
            df = pd.read_parquet(hist_path)
            df = make_price_features(df)
            df["ticker"] = ticker
            df = attach_sentiment(df, ticker, sentiment_map)
            batch_frames.append(df)
            found += 1
            if info_path.exists():
                info = json.loads(info_path.read_text(encoding="utf-8"))
                batch_info_rows.append({"ticker": ticker, **info})
        except Exception as e:
            errors += 1
            print(f"[features] skip {ticker}: {e}", flush=True)
            continue

        if i % PRINT_EVERY == 0:
            print(
                f"[features] {i}/{total} found={found} missing={missing} err={errors}",
                flush=True,
            )

        if len(batch_frames) >= FEAT_BATCH:
            n = flush_part(batch_frames, batch_info_rows, part_id)
            part_rows += n
            print(f"[features] flush part {part_id} rows={n} total={part_rows}", flush=True)
            part_id += 1
            batch_frames, batch_info_rows = [], []

    if batch_frames:
        n = flush_part(batch_frames, batch_info_rows, part_id)
        part_rows += n
        print(f"[features] flush final part {part_id} rows={n} total={part_rows}", flush=True)

    parts = sorted(PART_DIR.glob("features_part_*.parquet"))
    if not parts:
        raise RuntimeError("no features_part files; check raw data")

    print(f"[features] combining {len(parts)} parts...", flush=True)
    final = pd.concat((pd.read_parquet(f) for f in parts), ignore_index=True)
    final = clean_for_parquet(final)
    final.to_parquet(OUT_PANEL, index=False)
    ok_s = all(c in final.columns for c in SENTIMENT_COLS)
    ok_y = all(c in final.columns for c in OUTPUT_COLS)
    print(
        f"[features] rows={len(final)} sentiment={ok_s} multi_y={ok_y} -> {OUT_PANEL}",
        flush=True,
    )


def stage_split() -> None:
    ensure_dirs()
    for d in (TRAIN_DIR, VALID_DIR):
        for old in d.glob("*.parquet"):
            old.unlink()

    files = sorted(PART_DIR.glob("features_part_*.parquet"))
    if not files:
        raise FileNotFoundError(f"No feature parts in {PART_DIR}")

    train_count = valid_count = 0
    print(f"[split] parts={len(files)}", flush=True)

    for i, f in enumerate(files, 1):
        df = pd.read_parquet(f)
        df["date"] = pd.to_datetime(df["date"])
        # 需要完整 12 個 label（最長 horizon 可算）
        df = df.dropna(subset=OUTPUT_COLS)
        train = df[(df["date"] >= TRAIN_START) & (df["date"] <= TRAIN_END)].copy()
        valid = df[(df["date"] >= VALID_START) & (df["date"] <= VALID_END)].copy()
        if len(train):
            train.to_parquet(TRAIN_DIR / f"train_part_{i:04d}.parquet", index=False)
            train_count += len(train)
        if len(valid):
            valid.to_parquet(VALID_DIR / f"valid_part_{i:04d}.parquet", index=False)
            valid_count += len(valid)
        if i % 10 == 0 or i == len(files):
            print(
                f"[split] {i}/{len(files)} train={train_count} valid={valid_count}",
                flush=True,
            )
    print(f"[split] done train={train_count} valid={valid_count}", flush=True)


def focal_loss(gamma: float = 2.0, alpha: float = 0.25):
    """
    Multi-label focal loss.
    Focuses training on hard / rare positive examples (important for y_*_30).
    """
    def loss_fn(y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        y_pred = tf.clip_by_value(y_pred, 1e-7, 1.0 - 1e-7)
        bce = -(y_true * tf.math.log(y_pred) + (1.0 - y_true) * tf.math.log(1.0 - y_pred))
        p_t = y_true * y_pred + (1.0 - y_true) * (1.0 - y_pred)
        alpha_t = y_true * alpha + (1.0 - y_true) * (1.0 - alpha)
        modulating = tf.pow(1.0 - p_t, gamma)
        return tf.reduce_mean(alpha_t * modulating * bce)
    return loss_fn


def build_mlp(input_dim: int, n_outputs: int = 12) -> keras.Model:
    """
    Improved multi-output MLP (v2):
      - BatchNormalization for stable training
      - Slightly deeper (256 → 128 → 64)
      - Stronger dropout
      - Focal loss to handle rare high-threshold positives
    Still small enough for on-device TFLite.
    """
    inputs = keras.Input(shape=(input_dim,), name="features")

    x = keras.layers.Dense(256)(inputs)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Activation("relu")(x)
    x = keras.layers.Dropout(0.35)(x)

    x = keras.layers.Dense(128)(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Activation("relu")(x)
    x = keras.layers.Dropout(0.30)(x)

    x = keras.layers.Dense(64)(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Activation("relu")(x)
    x = keras.layers.Dropout(0.25)(x)

    outputs = keras.layers.Dense(n_outputs, activation="sigmoid", name="multi_prob")(x)
    model = keras.Model(inputs=inputs, outputs=outputs, name="us_market_multi_v2")
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=1e-3),
        loss=focal_loss(gamma=2.0, alpha=0.25),
        metrics=[keras.metrics.AUC(name="auc", multi_label=True)],
    )
    return model



def stage_train() -> None:
    ensure_dirs()
    parts = sorted(TRAIN_DIR.glob("train_part_*.parquet"))
    if not parts:
        raise FileNotFoundError(f"No train parts in {TRAIN_DIR}")

    sample = pd.read_parquet(parts[0])
    missing_y = [c for c in OUTPUT_COLS if c not in sample.columns]
    if missing_y:
        raise RuntimeError(
            f"train parts 缺少 multi-label 欄位 {missing_y}。"
            "請先重新跑 --stage features 與 --stage split"
        )

    feature_cols = get_feature_cols(sample)
    joblib.dump(feature_cols, OUT / "feature_cols.pkl")
    (OUT / "feature_cols.json").write_text(
        json.dumps(feature_cols, indent=2), encoding="utf-8"
    )
    (OUT / "output_cols.json").write_text(
        json.dumps(
            {
                "output_cols": OUTPUT_COLS,
                "horizons": HORIZONS,
                "thresholds": THRESHOLDS,
                "index_map": {name: i for i, name in enumerate(OUTPUT_COLS)},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    used_sent = [c for c in SENTIMENT_COLS if c in feature_cols]
    print(
        f"[train] features={len(feature_cols)} outputs={len(OUTPUT_COLS)} "
        f"sentiment={used_sent}",
        flush=True,
    )

    scaler = StandardScaler()
    total_rows = 0
    for i, f in enumerate(parts, 1):
        df = pd.read_parquet(f).dropna(subset=OUTPUT_COLS)
        X, _ = make_xy(df, feature_cols)
        scaler.partial_fit(X)
        total_rows += len(df)
        if i % 10 == 0 or i == len(parts):
            print(f"[train] partial_fit {i}/{len(parts)} rows={total_rows}", flush=True)

    # Estimate positive rates (for logging / imbalance awareness)
    pos_rates = None
    try:
        sample_y = []
        for f in parts[: min(20, len(parts))]:
            df = pd.read_parquet(f).dropna(subset=OUTPUT_COLS)
            sample_y.append(df[OUTPUT_COLS].values)
        if sample_y:
            pos_rates = np.concatenate(sample_y, axis=0).mean(axis=0)
            print(f"[train] approx pos rates: {np.round(pos_rates, 3)}", flush=True)
    except Exception as e:
        print(f"[train] pos rate sample failed: {e}", flush=True)

    model = build_mlp(len(feature_cols), n_outputs=len(OUTPUT_COLS))
    model.summary()

    # Better callbacks (monitor training AUC since we train part-by-part)
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="auc", mode="max", patience=4, restore_best_weights=True
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="auc", mode="max", factor=0.5, patience=2, min_lr=1e-5, verbose=1
        ),
    ]

    seen = 0
    for i, f in enumerate(parts, 1):
        df = pd.read_parquet(f).dropna(subset=OUTPUT_COLS)
        X, y = make_xy(df, feature_cols)
        Xs = scaler.transform(X)
        yv = y.values.astype(np.float32)
        if i == 1:
            # Build the graph once
            model.fit(Xs[:1], yv[:1], epochs=1, batch_size=1, verbose=0)
        model.fit(
            Xs,
            yv,
            epochs=1,
            batch_size=1024,
            verbose=1,
            callbacks=callbacks,
            shuffle=True,
        )
        seen += len(df)
        print(f"[train] part {i}/{len(parts)} seen={seen}", flush=True)

    model.save(OUT / "model.keras")
    joblib.dump(scaler, OUT / "scaler.joblib")
    print(
        f"[train] done rows={total_rows} features={len(feature_cols)} "
        f"outputs={len(OUTPUT_COLS)} -> {OUT}",
        flush=True,
    )


def stage_validate(threshold: float = 0.5) -> None:
    feature_cols = joblib.load(OUT / "feature_cols.pkl")
    scaler = joblib.load(OUT / "scaler.joblib")
    model = keras.models.load_model(
        OUT / "model.keras",
        custom_objects={"loss_fn": focal_loss(gamma=2.0, alpha=0.25)},
        compile=False,
    )
    parts = sorted(VALID_DIR.glob("valid_part_*.parquet"))
    if not parts:
        raise FileNotFoundError(f"No valid parts in {VALID_DIR}")

    y_true_all = []
    y_pred_all = []
    meta_tickers, meta_dates = [], []
    total = 0

    for i, f in enumerate(parts, 1):
        df = pd.read_parquet(f).dropna(subset=OUTPUT_COLS)
        X, y = make_xy(df, feature_cols)
        pred = model.predict(scaler.transform(X), verbose=0)
        if pred.ndim == 1:
            pred = pred.reshape(-1, 1)
        y_true_all.append(y.values.astype(np.float32))
        y_pred_all.append(pred.astype(np.float32))
        meta_tickers.append(df["ticker"].values)
        meta_dates.append(df["date"].values)
        total += len(df)
        if i % 10 == 0 or i == len(parts):
            print(f"[validate] {i}/{len(parts)} rows={total}", flush=True)

    y_true = np.concatenate(y_true_all, axis=0)
    y_pred = np.concatenate(y_pred_all, axis=0)
    tickers = np.concatenate(meta_tickers)
    dates = np.concatenate(meta_dates)

    metrics_rows = []
    pred_frame = {"ticker": tickers, "date": dates}

    for j, name in enumerate(OUTPUT_COLS):
        yt = y_true[:, j]
        yp = y_pred[:, j]
        # 全同一類時 AUC 會掛
        try:
            auc = float(roc_auc_score(yt, yp))
        except ValueError:
            auc = float("nan")
        y_cls = (yp >= threshold).astype(int)
        p = float(precision_score(yt, y_cls, zero_division=0))
        r = float(recall_score(yt, y_cls, zero_division=0))
        f1 = float(f1_score(yt, y_cls, zero_division=0))
        metrics_rows.append(
            {
                "output": name,
                "auc": auc,
                "threshold": threshold,
                "precision": p,
                "recall": r,
                "f1": f1,
            }
        )
        pred_frame[f"{name}_true"] = yt
        pred_frame[f"{name}_prob"] = yp
        print(
            f"[validate] {name}: auc={auc:.4f} P={p:.4f} R={r:.4f} F1={f1:.4f}",
            flush=True,
        )

    pd.DataFrame(pred_frame).to_csv(OUT / "validation_predictions.csv", index=False)
    pd.DataFrame(metrics_rows).to_csv(OUT / "metrics.csv", index=False)

    # 主指標：與舊版最接近的 12m / 30%
    main = next(m for m in metrics_rows if m["output"] == "y_12m_30")
    print(
        f"[validate] primary y_12m_30 auc={main['auc']:.4f} "
        f"thr={threshold:.2f} F1={main['f1']:.4f}",
        flush=True,
    )


def stage_threshold() -> None:
    feature_cols = joblib.load(OUT / "feature_cols.pkl")
    scaler = joblib.load(OUT / "scaler.joblib")
    model = keras.models.load_model(
        OUT / "model.keras",
        custom_objects={"loss_fn": focal_loss(gamma=2.0, alpha=0.25)},
        compile=False,
    )
    parts = sorted(VALID_DIR.glob("valid_part_*.parquet"))
    if not parts:
        raise FileNotFoundError(f"No valid parts in {VALID_DIR}")

    y_true_all, y_pred_all = [], []
    for i, f in enumerate(parts, 1):
        df = pd.read_parquet(f).dropna(subset=OUTPUT_COLS)
        X, y = make_xy(df, feature_cols)
        pred = model.predict(scaler.transform(X), verbose=0)
        if pred.ndim == 1:
            pred = pred.reshape(-1, 1)
        y_true_all.append(y.values.astype(np.float32))
        y_pred_all.append(pred.astype(np.float32))
        if i % 10 == 0 or i == len(parts):
            print(f"[threshold] loaded {i}/{len(parts)}", flush=True)

    y_true = np.concatenate(y_true_all, axis=0)
    y_pred = np.concatenate(y_pred_all, axis=0)

    rows = []
    summary = []
    for j, name in enumerate(OUTPUT_COLS):
        yt = y_true[:, j]
        yp = y_pred[:, j]
        try:
            auc = float(roc_auc_score(yt, yp))
        except ValueError:
            auc = float("nan")
        best = None
        for t in np.round(np.arange(0.05, 0.96, 0.01), 2):
            y_cls = (yp >= t).astype(int)
            rec = {
                "output": name,
                "threshold": float(t),
                "precision": float(precision_score(yt, y_cls, zero_division=0)),
                "recall": float(recall_score(yt, y_cls, zero_division=0)),
                "f1": float(f1_score(yt, y_cls, zero_division=0)),
                "auc": auc,
            }
            rows.append(rec)
            if best is None or (rec["f1"], rec["precision"]) > (
                best["f1"],
                best["precision"],
            ):
                best = rec
        summary.append(best)
        print(
            f"[threshold] {name}: best_thr={best['threshold']:.2f} "
            f"F1={best['f1']:.4f} auc={auc:.4f}",
            flush=True,
        )

    pd.DataFrame(rows).to_csv(OUT / "threshold_sweep.csv", index=False)
    pd.DataFrame(summary).to_csv(OUT / "threshold_summary.csv", index=False)


def main():
    parser = argparse.ArgumentParser(
        description="US market pipeline: multi-horizon/threshold + sentiment"
    )
    parser.add_argument(
        "--stage",
        choices=["features", "split", "train", "validate", "threshold", "all"],
        default="all",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.5,
        help="validate 決策門檻（各 output 共用；細部用 threshold stage）",
    )
    args = parser.parse_args()

    stages = (
        ["features", "split", "train", "validate", "threshold"]
        if args.stage == "all"
        else [args.stage]
    )
    for s in stages:
        print(f"\n======== STAGE: {s} ========", flush=True)
        if s == "features":
            stage_features()
        elif s == "split":
            stage_split()
        elif s == "train":
            stage_train()
        elif s == "validate":
            stage_validate(threshold=args.threshold)
        elif s == "threshold":
            stage_threshold()
    print("\n[pipeline] finished.", flush=True)
    print(f"[pipeline] output_cols = {OUTPUT_COLS}", flush=True)


if __name__ == "__main__":
    main()
