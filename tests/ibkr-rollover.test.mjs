import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileIbkrNavRollover } from '../lib/ibkr-rollover.js';

test('estimates the previous IBKR day from consecutive reset NAVs', () => {
  const history = {
    ibkr: [{ date: '2026-09-03', openingNav: 26879.28, nav: 26941.44, pnl: 62.16, confirmed: false }],
  };
  const result = reconcileIbkrNavRollover(history, {
    connected: true,
    sessionDate: '2026-09-04',
    nav: 27377.31,
    dailyPnl: 62.77,
  });
  assert.equal(result.ibkr[0].source, 'ibkr-nav-rollover-estimate');
  assert.equal(result.ibkr[0].estimated, true);
});

test('does not replace a confirmed Flex record', () => {
  const history = {
    ibkr: [{ date: '2026-09-03', openingNav: 100, nav: 105, pnl: 5, confirmed: true }],
  };
  const result = reconcileIbkrNavRollover(history, {
    connected: true,
    sessionDate: '2026-09-04',
    nav: 110,
    dailyPnl: 2,
  });
  assert.deepEqual(result, history);
});
