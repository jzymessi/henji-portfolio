import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLongbridgeDailyWindow } from '../lib/longbridge-daily.js';

test('accepts an exact completed Longbridge daily window', () => {
  assert.equal(
    validateLongbridgeDailyWindow(
      { start_date: '2026-09-01', end_date: '2026-09-02' },
      '2026-09-02',
      new Date('2026-09-04T01:00:00Z'),
    ).valid,
    true,
  );
});

test('rejects a response that silently expands across multiple dates', () => {
  const result = validateLongbridgeDailyWindow(
    { start_date: '2026-09-02', end_date: '2026-09-04' },
    '2026-09-03',
    new Date('2026-09-04T01:00:00Z'),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /不一致/);
});
