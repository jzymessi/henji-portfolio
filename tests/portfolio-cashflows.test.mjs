import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileDailyCashFlows } from '../lib/portfolio-cashflows.js';

test('does not count a withdrawal as portfolio loss', () => {
  const result = reconcileDailyCashFlows(
    [
      { date: '2026-06-02', nav: 22700, pnl: 0, rate: 0 },
      { date: '2026-06-03', nav: 15657, pnl: -6150, rate: -27.09 },
    ],
    { '2026-06-03': -7000 },
  );
  assert.equal(result[1].pnl, -43);
  assert.equal(result[1].source, 'longbridge-nav-cashflow');
});

test('keeps an official daily return authoritative', () => {
  const rows = [
    { date: '2026-09-02', nav: 1103.28, pnl: -5.99, rate: -0.54 },
    { date: '2026-09-03', nav: 1214.32, pnl: 111.03, rate: 10.06, source: 'longbridge-official', confirmed: true },
  ];
  const result = reconcileDailyCashFlows(rows, { '2026-09-03': -50 });
  assert.equal(result[1].pnl, 111.03);
  assert.equal(result[1].rate, 10.06);
});
