import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORTFOLIO_BRIDGE_PORT || 4318);
const projectRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(projectRoot, '.data');
const cachePath = path.join(dataDir, 'portfolio-cache.json');
const enabledBrokers = new Set(
  (process.env.PORTFOLIO_BROKERS || 'ibkr')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadIbkrLifetimePnl() {
  try {
    return JSON.parse(
      await readFile(
        path.join(projectRoot, '.data', 'ibkr-lifetime-pnl.json'),
        'utf8',
      ),
    );
  } catch {
    return {};
  }
}

async function fetchIbkrFromTws(lifetime) {
  const python =
    process.env.IBKR_TWS_PYTHON ||
    path.join(projectRoot, '.venv', 'bin', 'python');
  const { stdout } = await execFileAsync(
    python,
    [path.join(projectRoot, 'scripts', 'fetch-ibkr-tws.py')],
    { timeout: 25000, maxBuffer: 10 * 1024 * 1024 },
  );
  const snapshot = JSON.parse(stdout);
  return {
    connected: true,
    connection: `tws:${snapshot.port}`,
    updatedAt: new Date().toISOString(),
    accountId: snapshot.accountId,
    nav: number(snapshot.nav),
    dailyPnl:
      snapshot.dailyPnl === null || snapshot.dailyPnl === undefined
        ? null
        : number(snapshot.dailyPnl),
    positions: (snapshot.positions || []).map((item) => {
      const history =
        lifetime[String(item.conid)] || lifetime[item.symbol] || {};
      return {
        broker: 'IBKR',
        symbol: item.symbol,
        name: item.name || item.symbol,
        market: item.market || 'IBKR',
        quantity: number(item.quantity),
        currency: item.currency || 'USD',
        cost: number(item.cost),
        price: number(item.price),
        multiplier: number(item.multiplier, 1),
        dailyPnl:
          item.dailyPnl === null || item.dailyPnl === undefined
            ? null
            : number(item.dailyPnl),
        dayRate:
          item.dailyPnl === null || item.dailyPnl === undefined
            ? null
            : (() => {
                const marketValue =
                  number(item.marketValue) ||
                  number(item.quantity) *
                    number(item.multiplier, 1) *
                    number(item.price);
                const denominator = marketValue - number(item.dailyPnl);
                return denominator === 0
                  ? 0
                  : (number(item.dailyPnl) / denominator) * 100;
              })(),
        realizedPnlNet: number(
          history.realizedPnlNet ?? item.sessionRealizedPnl,
        ),
      };
    }),
    lifetimeSource: Object.keys(lifetime).length ? 'flex' : 'tws-session',
  };
}

async function fetchIbkr() {
  if (!enabledBrokers.has('ibkr'))
    return { connected: false, disabled: true, positions: [] };
  const lifetime = await loadIbkrLifetimePnl();
  try {
    return await fetchIbkrFromTws(lifetime);
  } catch (error) {
    return { connected: false, error: error.message, positions: [] };
  }
}

async function longbridgeJson(args) {
  const command = process.env.LONGBRIDGE_CLI || 'longbridge';
  const { stdout } = await execFileAsync(
    command,
    [...args, '--format', 'json'],
    { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

function collectObjects(value, predicate, result = []) {
  if (Array.isArray(value))
    for (const item of value) collectObjects(item, predicate, result);
  else if (value && typeof value === 'object') {
    if (predicate(value)) result.push(value);
    for (const child of Object.values(value))
      collectObjects(child, predicate, result);
  }
  return result;
}

function addUtcDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shiftLocalDate(date, { months = 0, years = 0 } = {}) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  value.setUTCFullYear(value.getUTCFullYear() - years);
  return value.toISOString().slice(0, 10);
}

async function fetchLongbridgePerformanceRanges(previous = {}) {
  const end = localDate();
  const starts = {
    today: end,
    month: `${end.slice(0, 7)}-01`,
    '1m': addUtcDays(end, -30),
    '6m': shiftLocalDate(end, { months: 6 }),
    ytd: `${end.slice(0, 4)}-01-01`,
    '1y': shiftLocalDate(end, { years: 1 }),
  };
  const result = { ...previous };
  for (const [key, start] of Object.entries(starts)) {
    try {
      const raw = await longbridgeJson(['profit-analysis', '--start', start, '--end', end]);
      result[key] = {
        startDate: start,
        endDate: end,
        pnl: number(raw.sum_profit),
        rate: number(raw.total_time_earning_yield ?? raw.sum_profit_rate) * 100,
        source: 'longbridge-twr',
      };
    } catch {
      // Keep the last successful range when Longbridge temporarily rate-limits.
    }
  }
  return result;
}

async function fetchLongbridgeExternalCashFlows(startDate) {
  const [flows, exchangeRates] = await Promise.all([
    longbridgeJson(['cash-flow', '--start', startDate, '--end', localDate()]),
    longbridgeJson(['exchange-rate']),
  ]);
  const rates = new Map(
    (exchangeRates?.exchanges || []).map((item) => [
      item.other_currency,
      number(item.average_rate, 1),
    ]),
  );
  const byDate = {};
  for (const item of Array.isArray(flows) ? flows : []) {
    if (!/^Cash (Withdrawal|Deposit)$/i.test(String(item.flow_name))) continue;
    const date = String(item.time || '').slice(0, 10);
    const rate = item.currency === 'USD' ? 1 : number(rates.get(item.currency), 1);
    byDate[date] = number(byDate[date]) + number(item.balance) * rate;
  }
  return byDate;
}

function usTradingSession(now = new Date()) {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const date = `${fields.year}-${fields.month}-${fields.day}`;
  const minutes = number(fields.hour) * 60 + number(fields.minute);
  if (minutes >= 20 * 60)
    return {
      key: 'overnight',
      label: '隔夜盘',
      date: addUtcDays(date, 1),
    };
  if (minutes < 4 * 60) return { key: 'overnight', label: '隔夜盘', date };
  if (minutes < 9 * 60 + 30) return { key: 'pre_market', label: '盘前', date };
  if (minutes < 16 * 60) return { key: 'regular', label: '常规盘', date };
  if (minutes < 20 * 60) return { key: 'post_market', label: '盘后', date };
  return { key: 'regular', label: '常规盘', date };
}

function isUsOption(symbol) {
  return /^[A-Z.]+\d{6}[CP]\d+\.US$/.test(String(symbol));
}

function optionUnderlying(symbol) {
  return String(symbol).match(/^([A-Z.]+)\d{6}[CP]\d+\.US$/)?.[1];
}

function quoteForSession(quote, session) {
  if (!quote) return null;
  if (session.key === 'regular')
    return {
      last: number(quote.last),
      previousClose: number(quote.prev_close),
    };
  const extended = quote[session.key];
  if (!extended) return null;
  return {
    last: number(extended.last),
    previousClose: number(extended.prev_close),
  };
}

async function fetchLongbridge() {
  if (!enabledBrokers.has('longbridge'))
    return { connected: false, disabled: true, positions: [] };
  try {
    const [portfolioRaw, profitRaw] = await Promise.all([
      longbridgeJson(['portfolio']),
      longbridgeJson(['profit-analysis']).catch(() => ({})),
    ]);
    const overview = portfolioRaw?.overview || {};
    const rawPositions = collectObjects(
      portfolioRaw?.holdings || [],
      (item) => 'symbol' in item && 'quantity' in item,
    );
    const symbols = rawPositions.map((item) => item.symbol).filter(Boolean);
    const quotesRaw = symbols.length
      ? await longbridgeJson(['quote', ...symbols]).catch(() => [])
      : [];
    const quotes = collectObjects(
      quotesRaw,
      (item) => 'symbol' in item && 'last' in item,
    );
    const profitItems = collectObjects(
      profitRaw,
      (item) =>
        'symbol' in item &&
        ('pnl' in item || 'profit' in item || 'total_pnl' in item),
    );
    const session = usTradingSession();
    const extendedDailyPnl = rawPositions.reduce((sum, item) => {
      const quote = quotes.find(
        (candidate) => candidate.symbol === item.symbol,
      );
      const sessionQuote = quoteForSession(quote, session);
      if (!sessionQuote || sessionQuote.previousClose <= 0) return sum;
      const multiplier = isUsOption(item.symbol) ? 100 : 1;
      return (
        sum +
        number(item.quantity) *
          multiplier *
          (sessionQuote.last - sessionQuote.previousClose)
      );
    }, 0);
    return {
      connected: true,
      connection: 'longbridge-cli',
      updatedAt: new Date().toISOString(),
      sessionDate: session.date,
      sessionLabel: session.label,
      nav: number(overview.total_asset),
      dailyPnl:
        session.key === 'regular'
          ? number(overview.total_today_pl)
          : Number(extendedDailyPnl.toFixed(4)),
      positions: rawPositions.map((item) => {
        const underlying = optionUnderlying(item.symbol);
        const profit =
          profitItems.find((candidate) => candidate.symbol === item.symbol) ||
          (underlying
            ? profitItems.find(
                (candidate) => candidate.symbol === `${underlying}.US`,
              )
            : undefined) ||
          {};
        const market =
          item.market || String(item.symbol).split('.').at(-1) || 'LONGPORT';
        const multiplier = isUsOption(item.symbol) ? 100 : 1;
        const quantity = number(item.quantity ?? item.holding_units);
        const quote = quotes.find(
          (candidate) => candidate.symbol === item.symbol,
        );
        const sessionQuote = quoteForSession(quote, session);
        const profitHoldingValue = number(profit.holding_value, Number.NaN);
        const price =
          multiplier > 1 && Number.isFinite(profitHoldingValue) && quantity > 0
            ? profitHoldingValue / (quantity * multiplier)
            : number(sessionQuote?.last ?? item.market_price);
        const previousClose = number(
          sessionQuote?.previousClose ?? item.prev_close,
        );
        return {
          broker: 'LONGPORT',
          symbol: item.symbol,
          name: item.symbol_name || item.name || item.symbol,
          market,
          quantity,
          currency: item.currency || (market === 'HK' ? 'HKD' : 'USD'),
          cost: number(
            item.cost_price ?? item.costPrice ?? item.cost_net_asset_value,
          ),
          price,
          multiplier,
          dayRate:
            previousClose > 0
              ? ((price - previousClose) / previousClose) * 100
              : 0,
          realizedPnlNet: number(profit.realized_pnl ?? profit.realizedPnl),
          lifetimePnl: number(profit.pnl ?? profit.profit ?? profit.total_pnl),
        };
      }),
      lifetimeSource: profitItems.length ? 'profit-analysis' : 'position-cost',
    };
  } catch (error) {
    return { connected: false, error: error.message, positions: [] };
  }
}

const benchmarkDefinitions = {
  nasdaq: { label: '纳斯达克', symbol: '.IXIC.US' },
  sp500: { label: '标普 500', symbol: '.SPX.US' },
  dow: { label: '道琼斯', symbol: '.DJI.US' },
};

async function fetchBenchmarks(startDate) {
  const entries = [];
  for (const [key, definition] of Object.entries(benchmarkDefinitions)) {
    let rows;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        rows = await longbridgeJson([
          'kline', 'history', definition.symbol,
          '--start', startDate, '--end', localDate(), '--period', 'day',
        ]);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    if (rows) {
      entries.push([key, {
        ...definition,
        points: (Array.isArray(rows) ? rows : []).map((row) => ({
          date: String(row.time || row.date).slice(0, 10),
          close: number(row.close),
        })),
      }]);
    }
  }
  return Object.fromEntries(entries);
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function loadCache() {
  try {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    return {
      ...cached,
      accounts: {
        ibkr: enabledBrokers.has('ibkr')
          ? cached.accounts?.ibkr || { connected: false, positions: [] }
          : { connected: false, disabled: true, positions: [] },
        longbridge: enabledBrokers.has('longbridge')
          ? cached.accounts?.longbridge || { connected: false, positions: [] }
          : { connected: false, disabled: true, positions: [] },
      },
    };
  } catch {
    return {
      mode: 'disconnected',
      updatedAt: null,
      accounts: {
        ibkr: {
          connected: false,
          disabled: !enabledBrokers.has('ibkr'),
          positions: [],
        },
        longbridge: {
          connected: false,
          disabled: !enabledBrokers.has('longbridge'),
          positions: [],
        },
      },
      history: { ibkr: [], longbridge: [] },
    };
  }
}

function updateHistory(history, broker, account) {
  if (
    !account.connected ||
    account.dailyPnl === null ||
    account.dailyPnl === undefined
  )
    return history;
  const date = account.sessionDate || localDate();
  const pnl = number(account.dailyPnl);
  const nav = number(account.nav);
  const rate = nav - pnl === 0 ? 0 : (pnl / (nav - pnl)) * 100;
  const items = (history?.[broker] || []).filter((item) => item.date !== date);
  return { ...history, [broker]: [...items, { date, pnl, nav, rate }] };
}

async function refreshPortfolio(previous) {
  const historyDates = [
    ...(previous.history?.ibkr || []),
    ...(previous.history?.longbridge || []),
  ].map((item) => item.date).sort((a, b) => a.localeCompare(b));
  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const benchmarkStart = [historyDates[0], oneYearAgo.toISOString().slice(0, 10)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))[0];
  const [freshIbkr, freshLongbridge, freshBenchmarks] = await Promise.all([
    fetchIbkr(),
    fetchLongbridge(),
    enabledBrokers.has('longbridge')
      ? fetchBenchmarks(benchmarkStart)
          .then((items) => ({ ...previous.benchmarks, ...items }))
          .catch(() => previous.benchmarks || {})
      : Promise.resolve(previous.benchmarks || {}),
  ]);
  const ibkr = freshIbkr.disabled
    ? freshIbkr
    : freshIbkr.connected
    ? freshIbkr
    : { ...previous.accounts.ibkr, refreshError: freshIbkr.error };
  const longbridge = freshLongbridge.disabled
    ? freshLongbridge
    : freshLongbridge.connected
    ? freshLongbridge
    : { ...previous.accounts.longbridge, refreshError: freshLongbridge.error };
  let history = updateHistory(previous.history, 'ibkr', freshIbkr);
  history = updateHistory(history, 'longbridge', freshLongbridge);
  const longbridgePerformance = enabledBrokers.has('longbridge')
    ? await fetchLongbridgePerformanceRanges(
        previous.performanceRanges?.longbridge,
      )
    : {};
  const externalFlows = enabledBrokers.has('longbridge')
    ? await fetchLongbridgeExternalCashFlows(benchmarkStart).catch(() => null)
    : null;
  if (externalFlows) {
    history = {
      ...history,
      longbridge: (history.longbridge || []).map((item) => ({
        ...item,
        cashFlow: number(externalFlows[item.date]),
      })),
    };
  }
  const payload = {
    mode: ibkr.connected || longbridge.connected ? 'live' : 'disconnected',
    updatedAt: new Date().toISOString(),
    accounts: { ibkr, longbridge },
    history,
    benchmarks: freshBenchmarks,
    performanceRanges: { longbridge: longbridgePerformance },
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(allowedOrigins.has(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin' }
      : {}),
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  const url = new URL(request.url || '/', `http://localhost:${port}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(
      204,
      allowedOrigins.has(origin)
        ? {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': 'GET,OPTIONS',
          }
        : {},
    );
    return response.end();
  }
  if (
    request.method !== 'GET' ||
    !['/health', '/api/portfolio'].includes(url.pathname)
  )
    return sendJson(response, 404, { error: 'Not found' }, origin);
  const cached = await loadCache();
  const payload =
    url.pathname === '/api/portfolio' && url.searchParams.get('refresh') === '1'
      ? await refreshPortfolio(cached)
      : cached;
  sendJson(response, 200, payload, origin);
});

server.listen(port, '127.0.0.1', () =>
  console.log(`Portfolio bridge listening on http://127.0.0.1:${port}`),
);
