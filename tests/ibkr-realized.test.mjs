import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateIbkrRealizedPnl,
  recordIbkrSessionRealized,
} from '../lib/ibkr-realized.js';

test('adds TWS realized PnL after the Flex cutoff', () => {
  const ledger = recordIbkrSessionRealized(
    {},
    [{ conid: 123, symbol: 'DEMO', sessionRealizedPnl: 94.5 }],
    '2026-09-04',
  );
  assert.equal(
    calculateIbkrRealizedPnl(
      { realizedPnlNet: 12, asOfDate: '2026-08-31' },
      ledger,
      { conid: 123, symbol: 'DEMO' },
    ),
    106.5,
  );
});

test('replaces rather than accumulates repeated intraday snapshots', () => {
  const first = recordIbkrSessionRealized(
    {},
    [{ conid: 1, symbol: 'ABC', sessionRealizedPnl: 20 }],
    '2026-09-04',
  );
  const second = recordIbkrSessionRealized(
    first,
    [{ conid: 1, symbol: 'ABC', sessionRealizedPnl: 35 }],
    '2026-09-04',
  );
  assert.equal(
    calculateIbkrRealizedPnl({}, second, { conid: 1, symbol: 'ABC' }),
    35,
  );
});

test('does not double count a TWS day already covered by Flex', () => {
  const ledger = recordIbkrSessionRealized(
    {},
    [{ conid: 1, symbol: 'ABC', sessionRealizedPnl: 20 }],
    '2026-09-04',
  );
  assert.equal(
    calculateIbkrRealizedPnl(
      { realizedPnlNet: 80, asOfDate: '2026-09-04' },
      ledger,
      { conid: 1, symbol: 'ABC' },
    ),
    80,
  );
});
