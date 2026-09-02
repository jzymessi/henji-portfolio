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
const headerIndex = rows.findIndex(
  (row) =>
    row.includes('Symbol') &&
    (row.includes('Conid') || row.includes('ConidEx')),
);
if (headerIndex < 0)
  throw new Error('Could not find an IBKR Flex Trades header');
const headers = rows[headerIndex];
const records = rows
  .slice(headerIndex + 1)
  .filter((row) => row.length === headers.length);
const output = {};

for (const row of records) {
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
  output[symbol] = output[key];
}

const dataDirectory = path.resolve('.data');
await mkdir(dataDirectory, { recursive: true });
await writeFile(
  path.join(dataDirectory, 'ibkr-lifetime-pnl.json'),
  JSON.stringify(output, null, 2),
);
console.log(
  `Imported lifetime P&L for ${new Set(Object.values(output).map((item) => item.symbol)).size} symbols.`,
);
