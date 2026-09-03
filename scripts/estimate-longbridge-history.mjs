import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { usTradingDate } from '../lib/trading-time.js';

const execFileAsync = promisify(execFile);
const command = process.env.LONGBRIDGE_CLI || '/opt/homebrew/bin/longbridge';
const root = path.resolve(import.meta.dirname, '..');
const cachePath = path.join(root, '.data', 'portfolio-cache.json');
const snapshotPath = path.join(root, '.data', 'longbridge-statement-snapshots.json');
const pricePath = path.join(root, '.data', 'longbridge-price-history.json');
const startDate = process.argv[2] || '2026-01-01';
const endDate = process.argv[3] || usTradingDate();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextRequest = 0;
async function cli(args, timeout = 90000, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const now = Date.now();
      const slot = Math.max(now, nextRequest);
      nextRequest = slot + 1100;
      await wait(slot - now);
      const { stdout } = await execFileAsync(command, [...args, '--format', 'json'], {
        env: { ...process.env, LONGBRIDGE_REGION: process.env.LONGBRIDGE_REGION || 'global' },
        timeout,
        maxBuffer: 20 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await wait(1500 * (attempt + 1));
    }
  }
}
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, file);
}
const dateOnly = (value) => {
  const text = String(value || '').replaceAll('.', '-');
  if (/^\d{8}/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text.slice(0, 10);
};
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const iso = (date) => date.toISOString().slice(0, 10);
function addDays(date, days) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return iso(d); }
function businessDates(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) { const day = new Date(`${d}T00:00:00Z`).getUTCDay(); if (day > 0 && day < 6) out.push(d); } return out; }

const listed = await cli(['statement', 'list', '--type', 'daily', '--start-date', startDate, '--limit', '365']);
const records = (Array.isArray(listed) ? listed : []).filter((x) => dateOnly(x.date) >= startDate && dateOnly(x.date) <= endDate);
const snapshotCache = await readJson(snapshotPath, {});
const statements = [];
for (const item of records) {
  const itemDate = dateOnly(item.date);
  if (snapshotCache[itemDate]) {
    statements.push(snapshotCache[itemDate]);
    continue;
  }
  const raw = await cli(['statement', 'export', '--file-key', item.file_key]);
  const balances = raw.account_balances || [];
  const usdRate = number(balances.find((x) => x.currency === 'USD')?.rate, 1);
  const asset = raw.asset?.[0];
  const nav = number(asset?.total) / usdRate;
  if (!asset || !Number.isFinite(nav)) continue;
  const holdings = (raw.equity_holdings || [])
    .filter((x) => number(x.ledger_quantity) !== 0)
    .map((x) => ({
      symbol: `${x.code}.${x.market === 'US' ? 'US' : x.market === 'HK' ? 'HK' : x.market}`,
      quantity: number(x.ledger_quantity),
      price: number(x.close_price),
      currency: x.currency,
      fxToUsd: x.currency === 'HKD' ? usdRate : 1,
      value: number(x.market_value) / (x.currency === 'HKD' ? usdRate : 1),
      multiplier: x.equity_type === 'OP' ? 100 : 1,
    }));
  const snapshot = { date: itemDate, nav, holdings };
  statements.push(snapshot);
  snapshotCache[itemDate] = snapshot;
  await writeJson(snapshotPath, snapshotCache);
}
statements.sort((a, b) => a.date.localeCompare(b.date));
if (!statements.length) throw new Error('没有可用于估算的长桥日结单');

const symbols = [...new Set(statements.flatMap((x) => x.holdings.map((h) => h.symbol)))];
const priceCache = await readJson(pricePath, {});
const prices = new Map();
for (const symbol of symbols) {
  if (priceCache[symbol]) {
    prices.set(symbol, new Map(Object.entries(priceCache[symbol])));
    continue;
  }
  try {
    const raw = await cli(['kline', 'history', symbol, '--start', startDate, '--end', endDate, '--period', 'day'], 20000, 2);
    const rows = Array.isArray(raw) ? raw : raw?.candlesticks || raw?.data || [];
    const map = new Map();
    for (const row of rows) {
      const date = dateOnly(row.date || row.timestamp || row.time);
      const close = number(row.close ?? row.close_price);
      if (date && close) map.set(date, close);
    }
    prices.set(symbol, map);
    priceCache[symbol] = Object.fromEntries(map);
    await writeJson(pricePath, priceCache);
  } catch {
    prices.set(symbol, new Map());
    priceCache[symbol] = {};
    await writeJson(pricePath, priceCache);
  }
}

const confirmed = new Map(statements.map((x) => [x.date, x]));
const allDates = businessDates(statements[0].date, endDate);
const estimates = [];
let previous = statements[0];
for (const date of allDates) {
  const actual = confirmed.get(date);
  if (actual) { previous = actual; continue; }
  if (date < startDate) continue;
  let currentValue = 0;
  const holdings = previous.holdings.map((holding) => {
    const close = prices.get(holding.symbol)?.get(date) ?? holding.price;
    const value = close * holding.quantity * holding.multiplier / holding.fxToUsd;
    currentValue += value;
    return { ...holding, price: close, value };
  });
  const previousValue = previous.holdings.reduce((sum, h) => sum + h.value, 0);
  const cash = previous.nav - previousValue;
  const nav = cash + currentValue;
  const pnl = nav - previous.nav;
  estimates.push({ date, pnl, nav, rate: previous.nav ? (pnl / previous.nav) * 100 : 0, estimated: true });
  previous = { date, nav, holdings };
}

const cache = JSON.parse(await readFile(cachePath, 'utf8'));
const existing = (cache.history?.longbridge || []).filter((x) => !estimates.some((e) => e.date === x.date));
cache.history = { ...cache.history, longbridge: [...existing, ...estimates].sort((a, b) => a.date.localeCompare(b.date)) };
await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
console.log(JSON.stringify({ estimatedDays: estimates.length, firstDate: estimates[0]?.date, lastDate: estimates.at(-1)?.date, symbols: symbols.length }));
