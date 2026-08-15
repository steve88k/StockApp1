"""
Phase 1 — Financial PhraseBank 三分類情緒模型（最小版）

用法：
  1. 先把 PhraseBank 轉成 phrasebank_3class.csv
     （欄位：text, label, label_id ； label_id: 0=neg, 1=neu, 2=pos）
  2. pip install tensorflow pandas scikit-learn
  3. python train_sentiment_phase1.py

輸出（預設在 output/sentiment_model/）：
  - model.keras
  - sentiment.tflite
  - vectorizer_vocab.txt   （詞表，App 端 tokenizer 可對齊）
  - label_map.json
  - metrics.json
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------
CSV_PATH = Path("phrasebank_3class.csv")
OUT_DIR = Path("output/sentiment_model")
OUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_TOKENS = 8000          # 詞表大小
MAX_LEN = 64              # 句子最長 token 數（標題／短句夠用）
EMBED_DIM = 64
BATCH_SIZE = 32
EPOCHS = 12
SEED = 42

LABEL_MAP = {"negative": 0, "neutral": 1, "positive": 2}
ID2LABEL = {v: k for k, v in LABEL_MAP.items()}


def load_data(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    required = {"text", "label_id"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV 缺少欄位: {missing}")
    df = df.dropna(subset=["text", "label_id"]).copy()
    df["text"] = df["text"].astype(str).str.strip()
    df["label_id"] = df["label_id"].astype(int)
    df = df[df["label_id"].isin([0, 1, 2])]
    df = df[df["text"].str.len() > 0]
    return df.reset_index(drop=True)


def build_model(vocab_size: int, max_len: int) -> tf.keras.Model:
    """極小文字分類：Embedding + pooling + dense → 3-class softmax。"""
    inputs = tf.keras.Input(shape=(max_len,), dtype="int32", name="input_ids")
    x = tf.keras.layers.Embedding(vocab_size, EMBED_DIM, name="embedding")(inputs)
    x = tf.keras.layers.GlobalAveragePooling1D()(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(3, activation="softmax", name="probs")(x)
    model = tf.keras.Model(inputs, outputs, name="sentiment_mini")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def main() -> None:
    tf.random.set_seed(SEED)
    np.random.seed(SEED)

    if not CSV_PATH.exists():
        raise FileNotFoundError(
            f"找不到 {CSV_PATH.resolve()}。請先產生 phrasebank_3class.csv"
        )

    df = load_data(CSV_PATH)
    print("label 分布:\n", df["label_id"].value_counts().sort_index())

    texts = df["text"].tolist()
    labels = df["label_id"].to_numpy()

    x_train, x_val, y_train, y_val = train_test_split(
        texts,
        labels,
        test_size=0.2,
        random_state=SEED,
        stratify=labels,
    )

    # ---- Tokenizer（訓練時 fit，並寫入模型前的 vectorize layer）----
    vectorizer = tf.keras.layers.TextVectorization(
        max_tokens=MAX_TOKENS,
        output_mode="int",
        output_sequence_length=MAX_LEN,
        name="vectorizer",
    )
    vectorizer.adapt(x_train)

    def vectorize(texts_list: list[str]) -> np.ndarray:
        return vectorizer(np.array(texts_list)).numpy().astype(np.int32)

    x_train_ids = vectorize(x_train)
    x_val_ids = vectorize(x_val)

    model = build_model(vocab_size=MAX_TOKENS, max_len=MAX_LEN)
    model.summary()

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=3,
            restore_best_weights=True,
        ),
    ]

    history = model.fit(
        x_train_ids,
        y_train,
        validation_data=(x_val_ids, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )

    # ---- 驗證 ----
    val_prob = model.predict(x_val_ids, verbose=0)
    val_pred = val_prob.argmax(axis=1)
    acc = float(accuracy_score(y_val, val_pred))
    report = classification_report(
        y_val,
        val_pred,
        target_names=[ID2LABEL[i] for i in range(3)],
        digits=4,
    )
    print("\nValidation accuracy:", round(acc, 4))
    print(report)

    # ---- 儲存 Keras 模型 ----
    keras_path = OUT_DIR / "model.keras"
    model.save(keras_path)
    print("saved", keras_path)

    # ---- 詞表（App 端若要自建 tokenizer 可對齊）----
    vocab = vectorizer.get_vocabulary()
    vocab_path = OUT_DIR / "vectorizer_vocab.txt"
    vocab_path.write_text("\n".join(vocab), encoding="utf-8")
    print("saved", vocab_path, "size=", len(vocab))

    # ---- label map ----
    label_path = OUT_DIR / "label_map.json"
    label_path.write_text(
        json.dumps({"label2id": LABEL_MAP, "id2label": ID2LABEL}, indent=2),
        encoding="utf-8",
    )

    metrics_path = OUT_DIR / "metrics.json"
    metrics_path.write_text(
        json.dumps(
            {
                "val_accuracy": acc,
                "max_len": MAX_LEN,
                "max_tokens": MAX_TOKENS,
                "embed_dim": EMBED_DIM,
                "n_train": len(x_train),
                "n_val": len(x_val),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    # ---- 轉 TFLite（輸入：int32 [1, MAX_LEN]；輸出：float32 [1, 3]）----
    # 注意：此 tflite 吃的是「已 tokenize 的 input_ids」，不是原始字串。
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()
    tflite_path = OUT_DIR / "sentiment.tflite"
    tflite_path.write_bytes(tflite_model)
    print("saved", tflite_path, "bytes=", len(tflite_model))

    # ---- 快速檢查 TFLite ----
    interpreter = tf.lite.Interpreter(model_path=str(tflite_path))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    print("TFLite input :", inp["shape"], inp["dtype"])
    print("TFLite output:", out["shape"], out["dtype"])

    sample_ids = x_val_ids[:1].astype(inp["dtype"])
    interpreter.set_tensor(inp["index"], sample_ids)
    interpreter.invoke()
    probs = interpreter.get_tensor(out["index"])[0]
    print(
        "sample probs [neg, neu, pos] =",
        np.round(probs, 4),
        "→",
        ID2LABEL[int(probs.argmax())],
    )
    print("sentiment_score = P_pos - P_neg =", round(float(probs[2] - probs[0]), 4))
    print("\nDone. Next: App 端用同一套 vocab 把 title → input_ids → sentiment.tflite")


if __name__ == "__main__":
    main()
