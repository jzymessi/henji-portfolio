import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const source = process.argv[2];
if (!source) {
  console.error(
    'Usage: npm run import:ibkr-flex -- /absolute/path/to/flex-trades.csv',
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

const rows = parseCsv(await readFile(path.resolve(source), 'utf8'));
const output = {};
let headers = [];
let tradesSection = false;
let reportEndDate = '';

for (const row of rows) {
  if (row[0] === 'ClientAccountID') {
    headers = row;
    tradesSection =
      row.includes('Symbol') &&
      (row.includes('Conid') || row.includes('ConidEx')) &&
      (row.includes('FifoPnlRealized') || row.includes('RealizedPnL'));
    continue;
  }
  if (!tradesSection || row.length !== headers.length) continue;
  const record = Object.fromEntries(
    headers.map((header, index) => [header, row[index]]),
  );
  const symbol = record.Symbol;
  const conid = record.Conid || record.ConidEx;
  if (!symbol || !conid) continue;
  const realized = Number(record.FifoPnlRealized || record.RealizedPnL || 0);
  const commission = Math.abs(
    Number(record.IBCommission || record.Commission || 0),
  );
  const key = String(conid);
  output[key] ||= { symbol, realizedPnlNet: 0 };
  output[key].realizedPnlNet += realized - commission;
  const rawDate = String(
    record.TradeDate || record.ReportDate || record.DateTime || '',
  );
  const compactDate = rawDate.match(/\d{8}/)?.[0];
  if (compactDate) {
    const date = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
    if (date > reportEndDate) reportEndDate = date;
  }
  output[symbol] = output[key];
}

if (!Object.keys(output).length)
  throw new Error('Could not find an IBKR Flex Trades section');
for (const item of new Set(Object.values(output))) item.asOfDate = reportEndDate;

const dataDirectory = path.resolve('.data');
await mkdir(dataDirectory, { recursive: true });
await writeFile(
  path.join(dataDirectory, 'ibkr-lifetime-pnl.json'),
  JSON.stringify(output, null, 2),
);
console.log(
  `Imported lifetime P&L for ${new Set(Object.values(output).map((item) => item.symbol)).size} symbols.`,
);
