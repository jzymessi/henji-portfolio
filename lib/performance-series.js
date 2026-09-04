export function buildPortfolioReturnPoints(items, initialAssetValue) {
  const sorted = [...(items || [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const openingBase = openingAssetValue(sorted[0], initialAssetValue);
  const useSimpleReturn = openingBase > 0;
  let cumulativePnl = 0;
  let cumulativeCashFlow = 0;
  let linkedReturn = 1;
  return sorted.map((item) => {
    cumulativePnl += Number(item.pnl) || 0;
    cumulativeCashFlow += Number(item.cashFlow) || 0;
    linkedReturn *= 1 + (Number(item.rate) || 0) / 100;
    const simpleBase = openingBase + Math.max(cumulativeCashFlow, 0);
    return {
      date: item.date,
      rate: useSimpleReturn
        ? (cumulativePnl / simpleBase) * 100
        : (linkedReturn - 1) * 100,
    };
  });
}

function openingAssetValue(first, explicitValue) {
  const explicit = Number(explicitValue);
  if (explicit > 0) return explicit;
  const reported = Number(first?.openingNav);
  if (reported > 0) return reported;
  const inferred =
    Number(first?.nav) -
    Number(first?.pnl || 0) -
    Number(first?.cashFlow || 0);
  return inferred > 0 ? inferred : 0;
}

export function calculateSimpleReturn(items, initialAssetValue) {
  const sorted = [...(items || [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const base = openingAssetValue(sorted[0], initialAssetValue);
  if (!sorted.length || !(base > 0)) return 0;
  const pnl = sorted.reduce((sum, item) => sum + (Number(item.pnl) || 0), 0);
  const netCashFlow = sorted.reduce(
    (sum, item) => sum + (Number(item.cashFlow) || 0),
    0,
  );
  return (pnl / (base + Math.max(netCashFlow, 0))) * 100;
}

export function combineBrokerDailyHistory(ibkrItems, longbridgeItems) {
  const ibkr = new Map((ibkrItems || []).map((item) => [item.date, item]));
  const longbridge = new Map(
    (longbridgeItems || []).map((item) => [item.date, item]),
  );
  const dates = [...new Set([...ibkr.keys(), ...longbridge.keys()])].sort(
    (a, b) => a.localeCompare(b),
  );
  const lastNav = { ibkr: 0, longbridge: 0 };
  return dates.map((date) => {
    const ibkrItem = ibkr.get(date);
    const longbridgeItem = longbridge.get(date);
    const opening = (item, carriedNav) =>
      item?.openingNav ??
      (item
        ? Number(item.nav) - Number(item.pnl) - Number(item.cashFlow || 0)
        : carriedNav);
    const openingNav =
      opening(ibkrItem, lastNav.ibkr) +
      opening(longbridgeItem, lastNav.longbridge);
    if (ibkrItem) lastNav.ibkr = Number(ibkrItem.nav);
    if (longbridgeItem) lastNav.longbridge = Number(longbridgeItem.nav);
    const contributors = [ibkrItem, longbridgeItem].filter(Boolean);
    const pnl = Number(ibkrItem?.pnl || 0) + Number(longbridgeItem?.pnl || 0);
    return {
      date,
      nav: lastNav.ibkr + lastNav.longbridge,
      pnl,
      cashFlow:
        Number(ibkrItem?.cashFlow || 0) +
        Number(longbridgeItem?.cashFlow || 0),
      openingNav,
      rate: openingNav ? (pnl / openingNav) * 100 : 0,
      estimated: Boolean(ibkrItem?.estimated || longbridgeItem?.estimated),
      confirmed: contributors.every((item) => item?.confirmed !== false),
    };
  });
}
