import { addUtcDays, newYorkClock, parseClockTime } from './trading-time.js';

export function validateLongbridgeDailyWindow(raw, date, now = new Date()) {
  const expectedStart = addUtcDays(date, -1);
  const reportedStart = String(raw?.start_date || '');
  const reportedEnd = String(raw?.end_date || '');
  if (reportedStart !== expectedStart || reportedEnd !== date) {
    return {
      valid: false,
      reason: `返回区间 ${reportedStart || '未知'} 至 ${reportedEnd || '未知'} 与请求单日不一致`,
    };
  }

  const clock = newYorkClock(now);
  if (date > clock.date) return { valid: false, reason: '请求日期尚未结束' };
  if (date === clock.date && clock.minutes < parseClockTime('16:30'))
    return { valid: false, reason: '美股常规盘尚未完成' };
  return { valid: true, reason: null };
}
