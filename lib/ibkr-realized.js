function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function recordIbkrSessionRealized(
  ledger = {},
  positions = [],
  date,
  capturedAt = new Date().toISOString(),
) {
  const entries = { ...ledger.daily?.[date] };
  for (const position of positions) {
    const key = String(position.conid || position.symbol || '');
    if (!key) continue;
    entries[key] = {
      symbol: position.symbol,
      realizedPnlNet: number(position.sessionRealizedPnl),
      capturedAt,
    };
  }
  return {
    version: 1,
    daily: {
      ...ledger.daily,
      [date]: entries,
    },
  };
}

export function calculateIbkrRealizedPnl(
  history = {},
  ledger = {},
  { conid, symbol } = {},
) {
  const cutoff = String(history.asOfDate || '');
  let total = number(history.realizedPnlNet);
  for (const [date, entries] of Object.entries(ledger.daily || {})) {
    if (cutoff && date <= cutoff) continue;
    const entry =
      entries?.[String(conid)] ||
      Object.values(entries || {}).find((item) => item?.symbol === symbol);
    total += number(entry?.realizedPnlNet);
  }
  return total;
}
