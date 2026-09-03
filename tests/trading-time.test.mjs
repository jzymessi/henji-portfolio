import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestScheduledWeekday,
  newYorkClock,
  usTradingSession,
} from '../lib/trading-time.js';

test('regular session stays on the New York calendar date', () => {
  assert.deepEqual(usTradingSession(new Date('2026-09-03T19:00:00Z')), {
    key: 'regular',
    label: '常规盘',
    date: '2026-09-03',
  });
});

test('post-market stays on the completed US trading date', () => {
  assert.deepEqual(usTradingSession(new Date('2026-09-03T21:00:00Z')), {
    key: 'post_market',
    label: '盘后',
    date: '2026-09-03',
  });
});

test('overnight session after 20:00 ET rolls into the next trading date', () => {
  assert.deepEqual(usTradingSession(new Date('2026-09-04T01:00:00Z')), {
    key: 'overnight',
    label: '隔夜盘',
    date: '2026-09-04',
  });
});

test('pre-04:00 ET remains on that US trading date', () => {
  assert.deepEqual(usTradingSession(new Date('2026-09-03T07:00:00Z')), {
    key: 'overnight',
    label: '隔夜盘',
    date: '2026-09-03',
  });
});

test('winter timezone conversion observes US standard time', () => {
  assert.deepEqual(usTradingSession(new Date('2026-01-03T01:00:00Z')), {
    key: 'overnight',
    label: '隔夜盘',
    date: '2026-01-03',
  });
});

test('daily schedule follows New York time across daylight saving time', () => {
  assert.deepEqual(newYorkClock(new Date('2026-09-03T20:30:00Z')), {
    date: '2026-09-03',
    weekday: 'Thu',
    minutes: 16 * 60 + 30,
  });
  assert.deepEqual(newYorkClock(new Date('2026-01-02T21:30:00Z')), {
    date: '2026-01-02',
    weekday: 'Fri',
    minutes: 16 * 60 + 30,
  });
});

test('schedule catches up the previous weekday after a shutdown', () => {
  assert.equal(
    latestScheduledWeekday(new Date('2026-09-08T14:00:00Z'), '16:30'),
    '2026-09-07',
  );
  assert.equal(
    latestScheduledWeekday(new Date('2026-09-06T16:00:00Z'), '16:30'),
    '2026-09-04',
  );
});
