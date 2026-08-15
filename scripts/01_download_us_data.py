import io
import json
import time
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

ROOT = Path("data/us_market")
RAW = ROOT / "raw"
ROOT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"
BATCH_SIZE = 250
BATCH_SLEEP = 1.5
TICKER_SLEEP = 0.25
MAX_TICKERS = 0
RESUME_FROM = 0

INFO_KEYS = [
    "marketCap", "enterpriseValue", "currentPrice", "targetMeanPrice", "targetMedianPrice",
    "recommendationMean", "numberOfAnalystOpinions", "beta", "trailingPE", "forwardPE",
    "priceToBook", "bookValue", "trailingEps", "forwardEps", "pegRatio", "dividendYield",
    "payoutRatio", "returnOnAssets", "returnOnEquity", "grossMargins", "operatingMargins",
    "ebitdaMargins", "profitMargins", "freeCashflow", "operatingCashflow", "totalCash",
    "totalDebt", "debtToEquity", "currentRatio", "quickRatio", "revenueGrowth",
    "earningsGrowth", "earningsQuarterlyGrowth", "totalRevenue", "ebitda", "grossProfits",
    "sharesOutstanding", "floatShares", "heldPercentInstitutions", "heldPercentInsiders",
    "shortRatio", "shortPercentOfFloat", "52WeekChange", "SandP52WeekChange",
]


def normalize_symbol(sym: str) -> str:
    return sym.replace('.', '-').strip()


def download_text(url: str) -> str:
    return requests.get(url, timeout=30).text


def build_universe():
    nasdaq = pd.read_csv(io.StringIO(download_text(NASDAQ_LISTED_URL)), sep='|', dtype=str)
    other = pd.read_csv(io.StringIO(download_text(OTHER_LISTED_URL)), sep='|', dtype=str)
    nasdaq = nasdaq[~nasdaq['Symbol'].astype(str).str.contains('File Creation Time', na=False)]
    other = other[~other['ACT Symbol'].astype(str).str.contains('File Creation Time', na=False)]
    nasdaq = nasdaq[(nasdaq['Test Issue'] == 'N') & (nasdaq['ETF'] == 'N')].copy()
    other = other[(other['Test Issue'] == 'N')].copy()
    symbols = sorted(set(nasdaq['Symbol'].dropna().map(normalize_symbol).tolist() + other['ACT Symbol'].dropna().map(normalize_symbol).tolist()))
    pd.DataFrame({'ticker': symbols}).to_csv(ROOT / 'us_ticker_universe.csv', index=False)
    return symbols


def safe_frame(obj):
    if obj is None:
        return pd.DataFrame()
    if isinstance(obj, pd.Series):
        obj = obj.to_frame('value')
    if isinstance(obj, pd.DataFrame):
        return obj.copy()
    return pd.DataFrame(obj)


def save_df(df, path):
    if df is not None and len(df) > 0:
        df.to_parquet(path, index=False)


def fetch_ticker(ticker):
    tk = yf.Ticker(ticker)
    try:
        hist = tk.history(start='2019-01-01', end='2026-06-01', auto_adjust=True, actions=True)
    except Exception:
        return False
    if hist is None or hist.empty:
        return False
    hist = hist.reset_index()
    hist['ticker'] = ticker
    hist.columns = [str(c).lower().replace(' ', '_') for c in hist.columns]
    save_df(hist, RAW / f'{ticker}_history.parquet')

    attrs = {
        'actions': safe_frame(getattr(tk, 'actions', None)),
        'dividends': safe_frame(getattr(tk, 'dividends', None)),
        'splits': safe_frame(getattr(tk, 'splits', None)),
        'recommendations': safe_frame(getattr(tk, 'recommendations', None)),
        'upgrades_downgrades': safe_frame(getattr(tk, 'upgrades_downgrades', None)),
        'earnings_dates': safe_frame(getattr(tk, 'earnings_dates', None)),
        'major_holders': safe_frame(getattr(tk, 'major_holders', None)),
        'institutional_holders': safe_frame(getattr(tk, 'institutional_holders', None)),
        'mutualfund_holders': safe_frame(getattr(tk, 'mutualfund_holders', None)),
        'insider_transactions': safe_frame(getattr(tk, 'insider_transactions', None)),
        'insider_purchases': safe_frame(getattr(tk, 'insider_purchases', None)),
        'insider_roster_holders': safe_frame(getattr(tk, 'insider_roster_holders', None)),
        'income_stmt_y': safe_frame(getattr(tk, 'income_stmt', None)),
        'income_stmt_q': safe_frame(getattr(tk, 'quarterly_income_stmt', None)),
        'balance_sheet_y': safe_frame(getattr(tk, 'balance_sheet', None)),
        'balance_sheet_q': safe_frame(getattr(tk, 'quarterly_balance_sheet', None)),
        'cashflow_y': safe_frame(getattr(tk, 'cashflow', None)),
        'cashflow_q': safe_frame(getattr(tk, 'quarterly_cashflow', None)),
        'ttm_income_stmt': safe_frame(getattr(tk, 'ttm_income_stmt', None)),
        'ttm_financials': safe_frame(getattr(tk, 'ttm_financials', None)),
        'ttm_cashflow': safe_frame(getattr(tk, 'ttm_cashflow', None)),
        'earnings_estimate': safe_frame(getattr(tk, 'earnings_estimate', None)),
        'revenue_estimate': safe_frame(getattr(tk, 'revenue_estimate', None)),
        'eps_trend': safe_frame(getattr(tk, 'eps_trend', None)),
        'eps_revisions': safe_frame(getattr(tk, 'eps_revisions', None)),
        'growth_estimates': safe_frame(getattr(tk, 'growth_estimates', None)),
    }
    for name, df in attrs.items():
        try:
            if df is not None and len(df) > 0:
                df = df.reset_index()
                df['ticker'] = ticker
                df.columns = [str(c).lower().replace(' ', '_') for c in df.columns]
                save_df(df, RAW / f'{ticker}_{name}.parquet')
        except Exception:
            pass

    try:
        info = tk.info or {}
    except Exception:
        info = {}
    small = {k: info.get(k) for k in INFO_KEYS}
    (RAW / f'{ticker}_info.json').write_text(json.dumps(small, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    time.sleep(TICKER_SLEEP)
    return True


def main():
    symbols = build_universe()
    if MAX_TICKERS > 0:
        symbols = symbols[:MAX_TICKERS]
    symbols = symbols[RESUME_FROM:]
    for i in range(0, len(symbols), BATCH_SIZE):
        batch = symbols[i:i+BATCH_SIZE]
        for ticker in batch:
            try:
                fetch_ticker(ticker)
            except Exception:
                pass
        time.sleep(BATCH_SLEEP)


if __name__ == '__main__':
    main()
