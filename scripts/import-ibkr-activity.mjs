import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const source = process.argv[2];
if (!source) {
  console.error(
    'Usage: npm run import:ibkr-activity -- /absolute/path/to/activity.csv',
  );
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (field || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    } else field += char;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

function numeric(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value) {
  const text = String(value || '');
  return text.length === 8
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : text;
}

const rows = parseCsv(await readFile(path.resolve(source), 'utf8'));
let section = null;
let headers = [];
const daily = [];
const realizedBySymbol = new Map();
let selectedAccountId = process.env.IBKR_ACCOUNT_ID || '';
let reportEndDate = '';

for (const row of rows) {
  if (!row.length) continue;
  if (row[0] === 'ClientAccountID') {
    headers = row;
    if (
      row.includes('StartingValue') &&
      row.includes('EndingValue') &&
      row.includes('TWR')
    )
      section = 'pnl';
    else if (row.includes('TotalRealizedPnl') && row.includes('Symbol'))
      section = 'realized';
    else section = null;
    continue;
  }
  if (row.length !== headers.length || !row[0]) continue;
  if (!selectedAccountId) selectedAccountId = row[0];
  if (row[0] !== selectedAccountId) continue;
  const record = Object.fromEntries(
    headers.map((header, index) => [header, row[index]]),
  );
  const reportDate = isoDate(
    record.ToDate || record.ReportDate || record.TradeDate,
  );
  if (reportDate > reportEndDate) reportEndDate = reportDate;
  if (section === 'pnl') {
    const date = isoDate(record.ToDate || record.FromDate);
    const openingNav = numeric(record.StartingValue);
    const nav = numeric(record.EndingValue);
    const rate = numeric(record.TWR);
    const cashFlow =
      numeric(record.DepositsWithdrawals) +
      numeric(record.InternalCashTransfers) +
      numeric(record.AssetTransfers);
    // IBKR's TWR is reported as a percentage. This conversion keeps the
    // amount and rate consistent with the dashboard's displayed denominator.
    const pnl = nav * (rate / 100) / (1 + rate / 100);
    if (date && Number.isFinite(nav) && Number.isFinite(rate))
      daily.push({
        date,
        pnl,
        nav,
        openingNav,
        rate,
        cashFlow,
        source: 'ibkr-flex-activity',
        confirmed: true,
      });
  } else if (section === 'realized' && record.Symbol) {
    const key = record.Conid || record.Symbol;
    const current = realizedBySymbol.get(key) || {
      symbol: record.Symbol,
      realizedPnlNet: 0,
    };
    current.realizedPnlNet += numeric(record.TotalRealizedPnl);
    realizedBySymbol.set(key, current);
  }
}

if (!daily.length)
  throw new Error('Could not find daily NAV/TWR rows in the IBKR activity CSV');

const dataDirectory = path.resolve('.data');
const cachePath = path.join(dataDirectory, 'portfolio-cache.json');
let cache;
try {
  cache = JSON.parse(await readFile(cachePath, 'utf8'));
} catch {
  cache = {
    mode: 'disconnected',
    updatedAt: null,
    accounts: {
      ibkr: { connected: false, positions: [] },
      longbridge: { connected: false, positions: [] },
    },
    history: { ibkr: [], longbridge: [] },
  };
}

const importedDates = new Set(daily.map((item) => item.date));
const existing = (cache.history?.ibkr || []).filter(
  (item) => !importedDates.has(item.date),
);
cache.history = {
  ...cache.history,
  ibkr: [...existing, ...daily].sort((a, b) => a.date.localeCompare(b.date)),
};
await mkdir(dataDirectory, { recursive: true });
await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');

if (realizedBySymbol.size) {
  const lifetimePath = path.join(dataDirectory, 'ibkr-lifetime-pnl.json');
  let lifetime = {};
  try {
    lifetime = JSON.parse(await readFile(lifetimePath, 'utf8'));
  } catch {
    // The report may be the first historical import.
  }
  for (const [key, value] of realizedBySymbol) {
    const imported = { ...value, asOfDate: reportEndDate };
    lifetime[key] = imported;
    lifetime[value.symbol] = imported;
  }
  await writeFile(lifetimePath, JSON.stringify(lifetime, null, 2), 'utf8');
}

console.log(
  JSON.stringify({
    importedDays: daily.length,
    firstDate: daily[0].date,
    lastDate: daily.at(-1).date,
    firstNav: daily[0].nav,
    lastNav: daily.at(-1).nav,
    firstRate: daily[0].rate,
    lastRate: daily.at(-1).rate,
    realizedSymbols: realizedBySymbol.size,
  }),
);
