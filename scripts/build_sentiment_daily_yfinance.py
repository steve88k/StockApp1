#!/usr/bin/env python3
"""
用 yfinance 抓 Yahoo 新聞標題 → 用既有 sentiment.tflite 打分
→ 產出 data/us_market/sentiment_daily.parquet

欄位：ticker, date, sentiment_score, news_count

限制（請先知道）：
  - yfinance 通常只能拿到「最近」的新聞（數天～數週），不是多年歷史
  - 對 2020–2025 訓練期覆蓋會很稀疏，但比全部是 0 好
  - 適合先驗證 pipeline，之後再換 Finnhub / 付費源補長歷史

前置：
  - pip install yfinance tensorflow pandas pyarrow
  - 已跑過 train_sentiment_phase1.py
    → output/sentiment_model/sentiment.tflite
    → output/sentiment_model/vectorizer_vocab.txt
  - data/us_market/us_ticker_universe.csv

用法：
  # 小規模測試（前 50 支）
  python build_sentiment_daily_yfinance.py --max-tickers 50

  # 全市場（會較慢，注意 rate limit）
  python build_sentiment_daily_yfinance.py

  # 只更新、合併既有 parquet
  python build_sentiment_daily_yfinance.py --max-tickers 200 --merge
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd

# -----------------------------------------------------------------------------
# Paths（與既有 pipeline 對齊）
# -----------------------------------------------------------------------------
ROOT = Path("data/us_market")
OUT = ROOT / "sentiment_daily.parquet"
UNIVERSE = ROOT / "us_ticker_universe.csv"

SENT_DIR = Path("output/sentiment_model")
TFLITE = SENT_DIR / "sentiment.tflite"
VOCAB = SENT_DIR / "vectorizer_vocab.txt"
MAX_LEN = 64


def load_vocab(path: Path) -> dict[str, int]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return {tok: i for i, tok in enumerate(lines)}


def tokenize(text: str, vocab: dict[str, int], max_len: int = MAX_LEN) -> np.ndarray:
    tokens = (
        text.lower()
        .replace(".", " ")
        .replace(",", " ")
        .replace(":", " ")
        .replace(";", " ")
        .replace("!", " ")
        .replace("?", " ")
        .split()
    )
    ids = [vocab.get(t, 1) for t in tokens]  # 1 常見為 [UNK]
    ids = ids[:max_len] + [0] * max(0, max_len - len(ids))
    return np.array([ids], dtype=np.int32)


def make_scorer(vocab: dict[str, int]):
    """回傳 score_one(title) -> float (P_pos - P_neg)。"""
    import tensorflow as tf

    interpreter = tf.lite.Interpreter(model_path=str(TFLITE))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]

    def score_one(title: str) -> float:
        if not title or not title.strip():
            return 0.0
        ids = tokenize(title, vocab).astype(inp["dtype"])
        interpreter.set_tensor(inp["index"], ids)
        interpreter.invoke()
        probs = interpreter.get_tensor(out["index"])[0]
        # 假設 0=neg, 1=neu, 2=pos（與 train_sentiment_phase1 一致）
        return float(probs[2] - probs[0])

    return score_one


def extract_articles(raw_news: list) -> list[dict]:
    """
    相容 yfinance 兩種常見結構：
      - 新版 nested: article["content"]["title"], article["content"]["pubDate"]
      - 舊版 flat:   article["title"], article["providerPublishTime"] (unix)
    """
    rows = []
    for article in raw_news or []:
        title = ""
        pub = None

        if isinstance(article, dict) and "content" in article:
            content = article.get("content") or {}
            title = (content.get("title") or content.get("summary") or "").strip()
            pub_str = content.get("pubDate") or content.get("displayTime") or ""
            if pub_str:
                try:
                    pub = pd.to_datetime(pub_str).tz_localize(None)
                except Exception:
                    pub = None
        else:
            title = (article.get("title") or article.get("summary") or "").strip()
            ts = article.get("providerPublishTime") or article.get("pubDate")
            if ts is not None:
                try:
                    # unix seconds or already datetime-like
                    if isinstance(ts, (int, float)):
                        pub = pd.to_datetime(ts, unit="s").tz_localize(None)
                    else:
                        pub = pd.to_datetime(ts).tz_localize(None)
                except Exception:
                    pub = None

        if title and pub is not None and not pd.isna(pub):
            rows.append({"title": title, "date": pub.normalize()})
    return rows


def fetch_ticker_news(ticker: str, score_one, sleep_s: float = 0.35) -> list[dict]:
    """抓單一 ticker 新聞並打分。失敗回空 list。"""
    try:
        import yfinance as yf
    except ImportError as e:
        raise SystemExit("請先安裝: pip install yfinance") from e

    try:
        t = yf.Ticker(ticker)
        raw = t.news or []
    except Exception as e:
        print(f"  [skip] {ticker} fetch error: {e}")
        return []

    articles = extract_articles(raw)
    out = []
    for a in articles:
        try:
            s = score_one(a["title"])
        except Exception:
            s = 0.0
        out.append(
            {
                "ticker": ticker.upper(),
                "date": a["date"],
                "sentiment_score": float(s),
                "news_count": 1.0,
            }
        )
    if sleep_s > 0:
        time.sleep(sleep_s)
    return out


def main():
    parser = argparse.ArgumentParser(description="Build sentiment_daily.parquet via yfinance")
    parser.add_argument("--max-tickers", type=int, default=None, help="只處理前 N 支（測試用）")
    parser.add_argument("--sleep", type=float, default=0.35, help="每支股票間隔秒數，避免被擋")
    parser.add_argument("--merge", action="store_true", help="與既有 parquet 合併（去重）")
    args = parser.parse_args()

    ROOT.mkdir(parents=True, exist_ok=True)

    if not TFLITE.exists() or not VOCAB.exists():
        raise FileNotFoundError(
            f"需要 {TFLITE} 與 {VOCAB}。請先跑: python train_sentiment_phase1.py"
        )
    if not UNIVERSE.exists():
        raise FileNotFoundError(f"缺少 {UNIVERSE}")

    tickers = (
        pd.read_csv(UNIVERSE)["ticker"]
        .dropna()
        .astype(str)
        .str.upper()
        .unique()
        .tolist()
    )
    if args.max_tickers is not None:
        tickers = tickers[: args.max_tickers]

    print(f"[info] tickers={len(tickers)}  tflite={TFLITE}")
    vocab = load_vocab(VOCAB)
    score_one = make_scorer(vocab)

    all_rows: list[dict] = []
    for i, ticker in enumerate(tickers, 1):
        rows = fetch_ticker_news(ticker, score_one, sleep_s=args.sleep)
        all_rows.extend(rows)
        if i % 20 == 0 or i == len(tickers):
            print(f"  [{i}/{len(tickers)}] collected article-rows={len(all_rows)}")

    if not all_rows:
        print("[warn] 沒抓到任何新聞，寫入空表")
        empty = pd.DataFrame(columns=["ticker", "date", "sentiment_score", "news_count"])
        empty.to_parquet(OUT, index=False)
        print(f"saved empty → {OUT}")
        return

    df = pd.DataFrame(all_rows)
    df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)

    # 同一天多則：平均分數、加總則數
    daily = (
        df.groupby(["ticker", "date"], as_index=False)
        .agg(
            sentiment_score=("sentiment_score", "mean"),
            news_count=("news_count", "sum"),
        )
        .sort_values(["ticker", "date"])
    )

    if args.merge and OUT.exists():
        old = pd.read_parquet(OUT)
        old["date"] = pd.to_datetime(old["date"]).dt.tz_localize(None)
        old["ticker"] = old["ticker"].astype(str).str.upper()
        combined = pd.concat([old, daily], ignore_index=True)
        combined = (
            combined.groupby(["ticker", "date"], as_index=False)
            .agg(
                sentiment_score=("sentiment_score", "mean"),
                news_count=("news_count", "sum"),
            )
            .sort_values(["ticker", "date"])
        )
        daily = combined
        print(f"[merge] total daily rows after merge: {len(daily)}")

    daily.to_parquet(OUT, index=False)
    print(daily.head(10))
    print(
        f"\n[done] rows={len(daily)}  tickers={daily['ticker'].nunique()}  "
        f"date range={daily['date'].min().date()} → {daily['date'].max().date()}"
    )
    print(f"saved → {OUT}")
    print(
        "\n下一步：\n"
        "  python pipeline_us_market_02_06.py --stage features\n"
        "  python pipeline_us_market_02_06.py --stage split\n"
        "  python pipeline_us_market_02_06.py --stage train\n"
        "  python pipeline_us_market_02_06.py --stage validate --threshold 0.5"
    )


if __name__ == "__main__":
    main()
