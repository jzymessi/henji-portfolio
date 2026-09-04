import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { validateLongbridgeDailyWindow } from '../lib/longbridge-daily.js';
import { usTradingDate } from '../lib/trading-time.js';

const execFileAsync = promisify(execFile);
const command = process.env.LONGBRIDGE_CLI || 'longbridge';
const root = path.resolve(import.meta.dirname, '..');
const cachePath = path.join(root, '.data', 'portfolio-cache.json');
const startDate = process.argv[2] || `${usTradingDate().slice(0, 4)}-01-01`;
const endDate = process.argv[3] || usTradingDate();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const number = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekdays(from, to) {
  const result = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day > 0 && day < 6) result.push(date);
  }
  return result;
}

async function readCache() {
  return JSON.parse(await readFile(cachePath, 'utf8'));
}

async function writeCache(cache) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.backfill.tmp`;
  await writeFile(temporary, JSON.stringify(cache, null, 2), 'utf8');
  await rename(temporary, cachePath);
}

async function fetchDaily(date, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        command,
        ['profit-analysis', '--start', date, '--end', date, '--format', 'json'],
        {
          env: {
            ...process.env,
            LONGBRIDGE_REGION: process.env.LONGBRIDGE_REGION || 'global',
          },
          timeout: 90000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      const raw = JSON.parse(stdout);
      const window = validateLongbridgeDailyWindow(raw, date);
      if (!window.valid) throw new Error(window.reason);
      const pnl = number(raw.sum_profit, Number.NaN);
      const nav = number(raw.ending_asset_value, Number.NaN);
      const openingNav = number(raw.initial_asset_value, Number.NaN);
      const rate =
        number(
          raw.total_time_earning_yield ?? raw.sum_profit_rate,
          Number.NaN,
        ) * 100;
      if (![pnl, nav, openingNav, rate].every(Number.isFinite))
        throw new Error('官方返回缺少单日收益字段');
      return {
        date,
        pnl,
        nav,
        openingNav,
        rate,
        source: 'longbridge-official',
        confirmed: true,
        estimated: false,
        reportedStartDate: raw.start_date,
        reportedEndDate: raw.end_date,
      };
    } catch (error) {
      if (attempt === attempts) throw error;
      await wait(1500 * attempt);
    }
  }
}

let cache = await readCache();
const confirmedDates = new Set(
  (cache.history?.longbridge || [])
    .filter((item) => item.confirmed && item.source === 'longbridge-official')
    .map((item) => item.date),
);
const candidates = weekdays(startDate, endDate)
  .filter((date) => !confirmedDates.has(date))
  .sort((a, b) => a.localeCompare(b));

let completed = 0;
let failed = 0;
for (const date of candidates) {
  try {
    const official = await fetchDaily(date);
    cache = await readCache();
    const items = cache.history?.longbridge || [];
    const current = items.find((item) => item.date === date);
    cache.history = {
      ...cache.history,
      longbridge: [
        ...items.filter((item) => item.date !== date),
        { ...current, ...official, cashFlow: number(current?.cashFlow) },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    };
    await writeCache(cache);
    completed += 1;
    console.log(
      `[${completed + failed}/${candidates.length}] ${date} 已保存 ${official.rate.toFixed(2)}%`,
    );
  } catch (error) {
    failed += 1;
    console.error(
      `[${completed + failed}/${candidates.length}] ${date} 跳过：${error.message}`,
    );
  }
  await wait(500);
}

console.log(JSON.stringify({ candidates: candidates.length, completed, failed }));
