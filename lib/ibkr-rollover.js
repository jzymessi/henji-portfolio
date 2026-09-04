import { addUtcDays } from './trading-time.js';

function previousWeekday(date) {
  let value = addUtcDays(date, -1);
  while ([0, 6].includes(new Date(`${value}T00:00:00Z`).getUTCDay()))
    value = addUtcDays(value, -1);
  return value;
}

export function reconcileIbkrNavRollover(history, account) {
  if (
    !account?.connected ||
    !account.sessionDate ||
    !Number.isFinite(account.nav) ||
    !Number.isFinite(account.dailyPnl)
  )
    return history;

  const date = previousWeekday(account.sessionDate);
  const current = (history?.ibkr || []).find((item) => item.date === date);
  if (!current || current.confirmed || !Number.isFinite(current.openingNav))
    return history;

  const nav = account.nav - account.dailyPnl;
  const cashFlow = Number.isFinite(current.cashFlow) ? current.cashFlow : 0;
  const pnl = nav - current.openingNav - cashFlow;
  const rate = current.openingNav ? (pnl / current.openingNav) * 100 : 0;
  return {
    ...history,
    ibkr: history.ibkr.map((item) =>
      item.date === date
        ? {
            ...item,
            pnl,
            nav,
            rate,
            source: 'ibkr-nav-rollover-estimate',
            confirmed: false,
            estimated: true,
          }
        : item,
    ),
  };
}
