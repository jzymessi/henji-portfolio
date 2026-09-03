import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { usTradingDate } from '../lib/trading-time.js';

const execFileAsync = promisify(execFile);
const command = process.env.LONGBRIDGE_CLI || '/opt/homebrew/bin/longbridge';
const startDate = process.argv[2] || '2026-01-01';
const endDate = process.argv[3] || usTradingDate();
const projectRoot = path.resolve(import.meta.dirname, '..');
const cachePath = path.join(projectRoot, '.data', 'portfolio-cache.json');

function numeric(value, fallback = 0) {
  const number = Number(String(value ?? '').replaceAll(',', ''));
  return Number.isFinite(number) ? number : fallback;
}

function dateFromStatement(value) {
  const text = String(value || '').replaceAll('.', '-');
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  return text;
}

async function cli(args, timeout = 60000) {
  const { stdout } = await execFileAsync(command, [...args, '--format', 'json'], {
    env: { ...process.env, LONGBRIDGE_REGION: process.env.LONGBRIDGE_REGION || 'global' },
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let nextRequestAt = 0;
async function acquireRequestSlot() {
  const now = Date.now();
  const start = Math.max(now, nextRequestAt);
  nextRequestAt = start + 1100;
  await wait(Math.max(0, start - now));
}

async function exportStatement(fileKey) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await acquireRequestSlot();
      return await cli(['statement', 'export', '--file-key', fileKey], 90000);
    } catch (error) {
      if (!String(error.stderr || error.message).match(/42900[23]/) || attempt === 3) throw error;
      await wait(1200 * (attempt + 1));
    }
  }
}

function externalCashFlow(statement) {
  const rows = statement.account_balance_changes || [];
  return rows.reduce((sum, row) => {
    const type = String(row.type || '').toLowerCase();
    if (!/(deposit|withdraw|transfer|入金|出金|转入|转出)/.test(type)) return sum;
    const amount = numeric(row.amount);
    const currency = String(row.currency || '').toUpperCase();
    const rate = currency === 'USD'
      ? numeric((statement.account_balances || []).find((item) => item.currency === 'USD')?.rate, 1)
      : 1;
    return sum + amount * rate;
  }, 0);
}

function parseStatement(statement, fallbackDate) {
  const asset = statement.asset?.[0];
  if (!asset) return null;
  const balances = statement.account_balances || [];
  const usdRate = numeric(balances.find((item) => item.currency === 'USD')?.rate, 1);
  const navHkd = numeric(asset.total, Number.NaN);
  if (!Number.isFinite(navHkd)) return null;
  const nav = navHkd / usdRate;
  const date = dateFromStatement(
    statement.account_balance_changes?.[0]?.date || fallbackDate,
  );
  return { date, nav, navHkd, externalCashFlowHkd: externalCashFlow(statement) };
}

const listed = await cli([
  'statement', 'list', '--type', 'daily', '--start-date', startDate, '--limit', '365',
]);
const records = (Array.isArray(listed) ? listed : []).filter((item) => {
  const date = dateFromStatement(item.date);
  return date >= startDate && date <= endDate && item.file_key;
});
if (!records.length) throw new Error(`没有找到 ${startDate} 至 ${endDate} 的长桥日结单`);

const statements = [];
let cursor = 0;
const workers = Array.from({ length: Math.min(8, records.length) }, async () => {
  while (cursor < records.length) {
    const item = records[cursor++];
    const statement = await exportStatement(item.file_key);
    const parsed = parseStatement(statement, item.date);
    if (parsed) statements.push(parsed);
  }
});
await Promise.all(workers);
statements.sort((a, b) => a.date.localeCompare(b.date));

const daily = statements.map((item, index) => {
  const previous = statements[index - 1];
  const pnl = previous ? item.nav - previous.nav - item.externalCashFlowHkd / (numeric((item.navHkd / item.nav), 1)) : 0;
  const base = previous?.nav || item.nav;
  return { date: item.date, pnl, nav: item.nav, rate: base ? (pnl / base) * 100 : 0 };
});

let cache;
try { cache = JSON.parse(await readFile(cachePath, 'utf8')); } catch {
  cache = { mode: 'disconnected', updatedAt: null, accounts: { ibkr: { connected: false, positions: [] }, longbridge: { connected: false, positions: [] } }, history: { ibkr: [], longbridge: [] } };
}
const dates = new Set(daily.map((item) => item.date));
const existing = (cache.history?.longbridge || []).filter((item) => !dates.has(item.date));
cache.history = { ...cache.history, longbridge: [...existing, ...daily].sort((a, b) => a.date.localeCompare(b.date)) };
await mkdir(path.dirname(cachePath), { recursive: true });
await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');

console.log(JSON.stringify({ importedDays: daily.length, firstDate: daily[0].date, lastDate: daily.at(-1).date, firstNav: daily[0].nav, lastNav: daily.at(-1).nav }));
