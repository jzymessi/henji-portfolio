export function reconcileDailyCashFlows(items, flows) {
  const sorted = [...(items || [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return sorted.map((item, index) => {
    const cashFlow = Number(flows?.[item.date] ?? item.cashFlow ?? 0);
    const previous = sorted[index - 1];
    if (!previous || !cashFlow || item.source === 'longbridge-official')
      return { ...item, cashFlow };

    const openingNav = Number(previous.nav);
    const pnl = Number(item.nav) - openingNav - cashFlow;
    return {
      ...item,
      cashFlow,
      openingNav,
      pnl,
      rate: openingNav ? (pnl / openingNav) * 100 : 0,
      source: 'longbridge-nav-cashflow',
    };
  });
}
