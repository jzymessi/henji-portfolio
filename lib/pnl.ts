export type PositionPnlInput = {
  quantity: number;
  multiplier?: number;
  marketPrice: number;
  openAverageCost: number;
  realizedPnlNet: number;
  cashDividends?: number;
  includeDividends?: boolean;
};

export type PositionPnlResult = {
  marketValue: number;
  unrealizedPnl: number;
  lifetimePnl: number;
  dilutedCost: number | null;
  lifetimeReturnRate: number | null;
  recovered: boolean;
};

/**
 * Unifies IBKR's open-position cost basis with Longbridge-style lifetime P&L.
 * `realizedPnlNet` must already include trading commissions and taxes.
 */
export function calculatePositionPnl({
  quantity,
  multiplier = 1,
  marketPrice,
  openAverageCost,
  realizedPnlNet,
  cashDividends = 0,
  includeDividends = false,
}: PositionPnlInput): PositionPnlResult {
  const units = quantity * multiplier;
  const marketValue = units * marketPrice;
  const unrealizedPnl = units * (marketPrice - openAverageCost);
  const lifetimePnl =
    unrealizedPnl + realizedPnlNet + (includeDividends ? cashDividends : 0);
  const adjustedBasis = marketValue - lifetimePnl;
  const dilutedCost = units === 0 ? null : adjustedBasis / units;
  const recovered = adjustedBasis <= 0;
  const lifetimeReturnRate = recovered
    ? null
    : (lifetimePnl / adjustedBasis) * 100;

  return {
    marketValue,
    unrealizedPnl,
    lifetimePnl,
    dilutedCost,
    lifetimeReturnRate,
    recovered,
  };
}
