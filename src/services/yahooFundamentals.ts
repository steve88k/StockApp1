import type {FundamentalInfo} from '../ml/featureBuilder';

export const YAHOO_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const CRUMB_TTL_MS = 55 * 60 * 1000;
const INFO_TTL_MS = 6 * 60 * 60 * 1000;
const QUOTE_MODULES = 'financialData,defaultKeyStatistics,summaryDetail';

export const FUNDAMENTAL_KEYS = [
  'marketCap',
  'enterpriseValue',
  'currentPrice',
  'targetMeanPrice',
  'targetMedianPrice',
  'recommendationMean',
  'numberOfAnalystOpinions',
  'beta',
  'trailingPE',
  'forwardPE',
  'priceToBook',
  'bookValue',
  'trailingEps',
  'forwardEps',
  'pegRatio',
  'dividendYield',
  'payoutRatio',
  'returnOnAssets',
  'returnOnEquity',
  'grossMargins',
  'operatingMargins',
  'ebitdaMargins',
  'profitMargins',
  'freeCashflow',
  'operatingCashflow',
  'totalCash',
  'totalDebt',
  'debtToEquity',
  'currentRatio',
  'quickRatio',
  'revenueGrowth',
  'earningsGrowth',
  'earningsQuarterlyGrowth',
  'totalRevenue',
  'ebitda',
  'grossProfits',
  'sharesOutstanding',
  'floatShares',
  'heldPercentInstitutions',
  'heldPercentInsiders',
  'shortRatio',
  'shortPercentOfFloat',
  '52WeekChange',
  'SandP52WeekChange',
] as const satisfies readonly (keyof FundamentalInfo)[];

type YahooSession = {
  cookie: string;
  crumb: string;
  at: number;
};

type CachedInfo = {
  info: FundamentalInfo;
  at: number;
};

let session: YahooSession | null = null;
let sessionPromise: Promise<YahooSession> | null = null;
const infoCache = new Map<string, CachedInfo>();

export function unwrapRaw(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    const n = Number((value as {raw: unknown}).raw);
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function isValidCrumb(crumb: string): boolean {
  const trimmed = crumb.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length < 80 &&
    !trimmed.includes('<') &&
    !/unauthorized|error|too many/i.test(trimmed)
  );
}

export function cookiesFromResponse(response: Response): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const parts: string[] =
    typeof headers.getSetCookie === 'function'
      ? [...headers.getSetCookie()]
      : [];
  if (!parts.length) {
    const single = headers.get('set-cookie') ?? headers.get('Set-Cookie');
    if (single) {
      parts.push(single);
    }
  }
  if (!parts.length) {
    headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie' && value) {
        parts.push(value);
      }
    });
  }

  const pairs: string[] = [];
  for (const part of parts) {
    const first = String(part).split(';')[0]?.trim();
    if (first && first.includes('=')) {
      pairs.push(first);
    }
  }
  return pairs.join('; ');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function pickFundamentalInfo(quoteSummaryResult: unknown): FundamentalInfo {
  const result = asRecord(quoteSummaryResult);
  const merged = {
    ...asRecord(result.summaryDetail),
    ...asRecord(result.defaultKeyStatistics),
    ...asRecord(result.financialData),
  };

  const info: FundamentalInfo = {};
  for (const key of FUNDAMENTAL_KEYS) {
    const n = unwrapRaw(merged[key]);
    if (n != null) {
      info[key] = n;
    }
  }
  return info;
}

export function countFilledFundamentals(info: FundamentalInfo): number {
  return FUNDAMENTAL_KEYS.reduce(
    (count, key) => (info[key] != null ? count + 1 : count),
    0,
  );
}

function yahooHeaders(cookie?: string, accept = 'application/json') {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': YAHOO_UA,
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

async function seedCookies(): Promise<string> {
  const seeds = ['https://fc.yahoo.com', 'https://finance.yahoo.com'];
  for (const url of seeds) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: yahooHeaders(undefined, 'text/html,application/xhtml+xml'),
      });
      const cookie = cookiesFromResponse(response);
      if (cookie) {
        return cookie;
      }
    } catch {
      // Seed endpoints may 404 / fail; cookie header can still be present.
    }
  }
  return '';
}

async function fetchCrumb(cookie: string): Promise<string> {
  const response = await fetch(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    {
      method: 'GET',
      headers: yahooHeaders(cookie, 'text/plain'),
    },
  );
  if (!response.ok) {
    throw new Error(`Yahoo crumb HTTP ${response.status}`);
  }
  const crumb = (await response.text()).trim();
  if (!isValidCrumb(crumb)) {
    throw new Error('Yahoo crumb invalid');
  }
  return crumb;
}

async function createSession(): Promise<YahooSession> {
  const cookie = await seedCookies();
  if (!cookie) {
    throw new Error('Yahoo cookie missing (Set-Cookie not exposed)');
  }
  const crumb = await fetchCrumb(cookie);
  return {cookie, crumb, at: Date.now()};
}

async function getSession(force = false): Promise<YahooSession> {
  if (
    !force &&
    session &&
    Date.now() - session.at < CRUMB_TTL_MS
  ) {
    return session;
  }
  if (!force && sessionPromise) {
    return sessionPromise;
  }

  const pending = createSession()
    .then(next => {
      session = next;
      return next;
    })
    .finally(() => {
      if (sessionPromise === pending) {
        sessionPromise = null;
      }
    });
  sessionPromise = pending;
  return pending;
}

function cachedInfo(symbol: string): FundamentalInfo | null {
  const hit = infoCache.get(symbol);
  if (!hit) {
    return null;
  }
  if (Date.now() - hit.at > INFO_TTL_MS) {
    infoCache.delete(symbol);
    return null;
  }
  return hit.info;
}

async function fetchQuoteSummary(
  symbol: string,
  yahoo: YahooSession,
): Promise<unknown> {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=${QUOTE_MODULES}` +
    `&crumb=${encodeURIComponent(yahoo.crumb)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: yahooHeaders(yahoo.cookie),
  });

  if (!response.ok) {
    const error = new Error(`Yahoo quoteSummary HTTP ${response.status}`);
    (error as Error & {status?: number}).status = response.status;
    throw error;
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new Error('Yahoo quoteSummary returned non-JSON');
  }
  const err = json?.quoteSummary?.error;
  if (err) {
    throw new Error(err.description || 'Yahoo quoteSummary error');
  }
  return json?.quoteSummary?.result?.[0] ?? null;
}

/**
 * yfinance-compatible fundamentals via Yahoo quoteSummary.
 * Failures throw; callers that must stay resilient should catch.
 */
export async function fetchYahooFundamentals(
  symbol: string,
): Promise<FundamentalInfo> {
  const cached = cachedInfo(symbol);
  if (cached) {
    return cached;
  }

  let yahoo = await getSession(false);
  let result: unknown;
  try {
    result = await fetchQuoteSummary(symbol, yahoo);
  } catch (error) {
    const status = (error as {status?: number}).status;
    if (status === 401 || status === 403) {
      session = null;
      yahoo = await getSession(true);
      result = await fetchQuoteSummary(symbol, yahoo);
    } else {
      throw error;
    }
  }

  const info = pickFundamentalInfo(result);
  infoCache.set(symbol, {info, at: Date.now()});
  return info;
}

/** Test-only: drop crumb / fundamentals caches. */
export function resetYahooFundamentalsCache() {
  session = null;
  sessionPromise = null;
  infoCache.clear();
}
