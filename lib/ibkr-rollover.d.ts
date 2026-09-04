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

type PortfolioAccount = {
  connected: boolean;
  sessionDate?: string;
  nav?: number;
  dailyPnl?: number | null;
};

export function reconcileIbkrNavRollover(
  history: { ibkr?: DailyReturn[]; longbridge?: DailyReturn[] },
  account: PortfolioAccount,
): { ibkr?: DailyReturn[]; longbridge?: DailyReturn[] };
