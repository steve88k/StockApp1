import {
  countFilledFundamentals,
  isValidCrumb,
  pickFundamentalInfo,
  unwrapRaw,
} from '../src/services/yahooFundamentals';

describe('unwrapRaw', () => {
  it('reads Yahoo { raw } wrappers', () => {
    expect(unwrapRaw({raw: 305.93, fmt: '305.93'})).toBe(305.93);
  });

  it('accepts bare numbers and rejects junk', () => {
    expect(unwrapRaw(41)).toBe(41);
    expect(unwrapRaw('12.5')).toBe(12.5);
    expect(unwrapRaw(null)).toBeUndefined();
    expect(unwrapRaw({raw: 'NaN'})).toBeUndefined();
  });
});

describe('isValidCrumb', () => {
  it('accepts typical Yahoo crumbs', () => {
    expect(isValidCrumb('wBAiN.vKYRr')).toBe(true);
  });

  it('rejects empty, HTML, and error bodies', () => {
    expect(isValidCrumb('')).toBe(false);
    expect(isValidCrumb('<html>nope</html>')).toBe(false);
    expect(isValidCrumb('Unauthorized')).toBe(false);
  });
});

describe('pickFundamentalInfo', () => {
  const sample = {
    summaryDetail: {
      marketCap: {raw: 4464797286400},
      trailingPE: {raw: 35.04},
      dividendYield: {raw: 0.0035},
    },
    defaultKeyStatistics: {
      enterpriseValue: {raw: 4476964438016},
      '52WeekChange': {raw: 0.322},
      SandP52WeekChange: {raw: 0.209},
      beta: {raw: 1.086},
    },
    financialData: {
      currentPrice: {raw: 305.93},
      recommendationMean: {raw: 2.13},
      profitMargins: {raw: 0.276},
      beta: {raw: 1.09},
    },
  };

  it('merges the three quoteSummary modules and unwraps raw values', () => {
    const info = pickFundamentalInfo(sample);
    expect(info.marketCap).toBe(4464797286400);
    expect(info.currentPrice).toBe(305.93);
    expect(info['52WeekChange']).toBe(0.322);
    expect(info.SandP52WeekChange).toBe(0.209);
    expect(info.recommendationMean).toBe(2.13);
    // financialData wins on overlap
    expect(info.beta).toBe(1.09);
    expect(countFilledFundamentals(info)).toBe(9);
  });

  it('returns {} when Yahoo sent nothing usable', () => {
    expect(pickFundamentalInfo(null)).toEqual({});
    expect(pickFundamentalInfo({})).toEqual({});
    expect(countFilledFundamentals({})).toBe(0);
  });
});
