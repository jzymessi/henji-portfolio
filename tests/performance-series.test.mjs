import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPortfolioReturnPoints,
  calculateSimpleReturn,
  combineBrokerDailyHistory,
} from '../lib/performance-series.js';

test('builds a simple-weighted curve from cumulative PnL', () => {
  const result = buildPortfolioReturnPoints(
    [
      { date: '2026-01-02', pnl: 100, rate: 1 },
      { date: '2026-01-05', pnl: -40, rate: -0.4 },
    ],
    2000,
  );
  assert.deepEqual(result, [
    { date: '2026-01-02', rate: 5 },
    { date: '2026-01-05', rate: 3 },
  ]);
});

test('adds net deposits to the simple-return denominator', () => {
  const result = calculateSimpleReturn([
    { date: '2026-01-02', nav: 1600, pnl: 100, cashFlow: 500, rate: 10 },
  ]);
  assert.ok(Math.abs(result - (100 / 1500) * 100) < 1e-10);
});

test('does not shrink the denominator after a net withdrawal', () => {
  const result = calculateSimpleReturn([
    { date: '2026-01-02', openingNav: 2000, nav: 1400, pnl: -100, cashFlow: -500, rate: -5 },
  ]);
  assert.equal(result, -5);
});

test('carries the other broker NAV into the combined opening balance', () => {
  const result = combineBrokerDailyHistory(
    [
      { date: '2026-06-01', openingNav: 1000, nav: 1010, pnl: 10, rate: 1 },
      { date: '2026-06-02', openingNav: 1010, nav: 1030, pnl: 20, rate: 1.98 },
    ],
    [{ date: '2026-06-01', openingNav: 500, nav: 505, pnl: 5, rate: 1 }],
  );
  assert.equal(result[1].openingNav, 1515);
  assert.equal(result[1].nav, 1535);
});
