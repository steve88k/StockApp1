#!/usr/bin/env python3
"""
將 pipeline 訓練好的 Keras 模型轉成 TFLite，並匯出 App 需要的 assets。

輸入（預設）：
  output/us_market_model/model.keras
  output/us_market_model/scaler.joblib
  output/us_market_model/feature_cols.json
  output/us_market_model/output_cols.json

輸出：
  output/us_market_model/us_market_model.tflite
  output/us_market_model/scaler.json          # App scaler.ts 用
  （可選）複製到 App assets 路徑

用法：
  python export_tflite.py
  python export_tflite.py --copy-to-app   # 若 App 在 ../StockApp1 或同層
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import joblib
import numpy as np
import tensorflow as tf
from tensorflow import keras

# 與 pipeline 一致的 focal loss（載入時需要）
def focal_loss(gamma: float = 2.0, alpha: float = 0.25):
    def loss_fn(y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        y_pred = tf.clip_by_value(y_pred, 1e-7, 1.0 - 1e-7)
        bce = -(y_true * tf.math.log(y_pred) + (1.0 - y_true) * tf.math.log(1.0 - y_pred))
        p_t = y_true * y_pred + (1.0 - y_true) * (1.0 - y_pred)
        alpha_t = y_true * alpha + (1.0 - y_true) * (1.0 - alpha)
        modulating = tf.pow(1.0 - p_t, gamma)
        return tf.reduce_mean(alpha_t * modulating * bce)

    return loss_fn


OUT = Path("output/us_market_model")
KERAS_PATH = OUT / "model.keras"
TFLITE_PATH = OUT / "us_market_model.tflite"
SCALER_JOBLIB = OUT / "scaler.joblib"
SCALER_JSON = OUT / "scaler.json"
FEATURE_COLS = OUT / "feature_cols.json"
OUTPUT_COLS = OUT / "output_cols.json"


def load_model():
    if not KERAS_PATH.exists():
        raise FileNotFoundError(f"找不到 {KERAS_PATH}，請先跑 pipeline --stage train")
    # compile=False 最穩（推理不需要 loss）
    try:
        model = keras.models.load_model(KERAS_PATH, compile=False)
    except Exception:
        model = keras.models.load_model(
            KERAS_PATH,
            custom_objects={"loss_fn": focal_loss()},
            compile=False,
        )
    return model


def convert_tflite(model: keras.Model) -> bytes:
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    # 預設優化（權重量化，體積更小、手機更快）
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    # 若遇到相容問題可改成不量化：
    # converter.optimizations = []
    tflite_model = converter.convert()
    return tflite_model


def export_scaler_json():
    if not SCALER_JOBLIB.exists():
        print(f"[warn] {SCALER_JOBLIB} 不存在，跳過 scaler.json")
        return
    scaler = joblib.load(SCALER_JOBLIB)
    mean = np.asarray(scaler.mean_, dtype=np.float64).tolist()
    scale = np.asarray(scaler.scale_, dtype=np.float64).tolist()
    # sklearn 用 scale_；有的版本是 std_
    if hasattr(scaler, "scale_") and scaler.scale_ is not None:
        scale = np.asarray(scaler.scale_, dtype=np.float64).tolist()
    payload = {"mean_": mean, "scale_": scale}
    SCALER_JSON.write_text(json.dumps(payload), encoding="utf-8")
    print(f"[ok] scaler.json  dims={len(mean)} → {SCALER_JSON}")


def smoke_test(model: keras.Model, tflite_bytes: bytes):
    """用隨機輸入比對 Keras vs TFLite 輸出是否接近。"""
    n_features = model.input_shape[-1]
    x = np.random.randn(1, n_features).astype(np.float32)

    keras_out = model.predict(x, verbose=0)[0]

    interpreter = tf.lite.Interpreter(model_content=tflite_bytes)
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    interpreter.set_tensor(inp["index"], x.astype(inp["dtype"]))
    interpreter.invoke()
    tflite_out = interpreter.get_tensor(out["index"])[0]

    max_diff = float(np.max(np.abs(keras_out - tflite_out)))
    print(f"[smoke] input_dim={n_features}  output_dim={len(keras_out)}")
    print(f"[smoke] max |keras - tflite| = {max_diff:.6f}")
    if max_diff > 1e-3:
        print("[warn] 差異偏大，請檢查 quantization / 模型結構")
    else:
        print("[ok] Keras ↔ TFLite 輸出一致")


def copy_to_app(app_assets: Path):
    app_assets.mkdir(parents=True, exist_ok=True)
    mapping = [
        (TFLITE_PATH, app_assets / "us_market_model.tflite"),
        (SCALER_JSON, app_assets / "scaler.json"),
        (FEATURE_COLS, app_assets / "feature_cols.json"),
        (OUTPUT_COLS, app_assets / "output_cols.json"),
    ]
    for src, dst in mapping:
        if src.exists():
            shutil.copy2(src, dst)
            print(f"[copy] {src.name} → {dst}")
        else:
            print(f"[skip] missing {src}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--copy-to-app",
        action="store_true",
        help="複製到 StockApp1/src/assets（若路徑存在）",
    )
    parser.add_argument(
        "--app-assets",
        type=str,
        default="StockApp1/src/assets",
        help="App assets 目錄",
    )
    parser.add_argument("--no-quantize", action="store_true", help="關閉 DEFAULT 優化")
    args = parser.parse_args()

    print("=" * 50)
    print("Export Keras → TFLite")
    print("=" * 50)

    model = load_model()
    model.summary()
    print(f"input shape: {model.input_shape}  output shape: {model.output_shape}")

    if args.no_quantize:
        converter = tf.lite.TFLiteConverter.from_keras_model(model)
        tflite_bytes = converter.convert()
    else:
        tflite_bytes = convert_tflite(model)

    TFLITE_PATH.write_bytes(tflite_bytes)
    print(f"[ok] TFLite {len(tflite_bytes):,} bytes → {TFLITE_PATH}")

    export_scaler_json()
    smoke_test(model, tflite_bytes)

    if args.copy_to_app:
        copy_to_app(Path(args.app_assets))

    print(
        "\n下一步（App）：\n"
        "  1. 確認 assets 有：us_market_model.tflite, scaler.json,\n"
        "     feature_cols.json, output_cols.json\n"
        "  2. stockApi.ts 的 DECISION_THR 已更新為 v2 最佳門檻\n"
        "  3. 重新 build App\n"
    )


if __name__ == "__main__":
    main()
