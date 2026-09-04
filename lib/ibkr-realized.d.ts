export type IbkrRealizedHistory = {
  symbol?: string;
  realizedPnlNet?: number;
  asOfDate?: string;
};

export type IbkrRealizedLedger = {
  version?: number;
  daily?: Record<
    string,
    Record<
      string,
      { symbol?: string; realizedPnlNet?: number; capturedAt?: string }
    >
  >;
};

export function recordIbkrSessionRealized(
  ledger: IbkrRealizedLedger,
  positions: Array<{
    conid?: string | number;
    symbol?: string;
    sessionRealizedPnl?: number;
  }>,
  date: string,
  capturedAt?: string,
): IbkrRealizedLedger;

export function calculateIbkrRealizedPnl(
  history: IbkrRealizedHistory,
  ledger: IbkrRealizedLedger,
  position: { conid?: string | number; symbol?: string },
): number;
