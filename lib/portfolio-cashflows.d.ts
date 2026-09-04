type DailyReturn = {
  date: string;
  pnl: number;
  nav: number;
  rate: number;
  openingNav?: number;
  cashFlow?: number;
  source?: string;
  confirmed?: boolean;
  estimated?: boolean;
};

export function reconcileDailyCashFlows(
  items: DailyReturn[],
  flows: Record<string, number>,
): DailyReturn[];
