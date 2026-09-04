export type PerformanceItem = {
  date: string;
  pnl: number;
  rate: number;
  nav?: number;
  openingNav?: number;
  cashFlow?: number;
  estimated?: boolean;
  confirmed?: boolean;
};

export function buildPortfolioReturnPoints(
  items: PerformanceItem[],
  initialAssetValue?: number,
): Array<{ date: string; rate: number }>;

export function calculateSimpleReturn(
  items: PerformanceItem[],
  initialAssetValue?: number,
): number;

export function combineBrokerDailyHistory(
  ibkrItems: PerformanceItem[],
  longbridgeItems: PerformanceItem[],
): Array<PerformanceItem & { nav: number; cashFlow: number }>;
