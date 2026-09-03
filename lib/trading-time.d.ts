export type UsTradingSession = {
  key: 'overnight' | 'pre_market' | 'regular' | 'post_market';
  label: '隔夜盘' | '盘前' | '常规盘' | '盘后';
  date: string;
};

export function addUtcDays(date: string, days: number): string;
export function newYorkClock(now?: Date): {
  date: string;
  weekday: string;
  minutes: number;
};
export function parseClockTime(value?: string, fallback?: string): number;
export function previousWeekday(date: string): string;
export function latestScheduledWeekday(now?: Date, time?: string): string;
export function usTradingSession(now?: Date): UsTradingSession;
export function usTradingDate(now?: Date): string;
