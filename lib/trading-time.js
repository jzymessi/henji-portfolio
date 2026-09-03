export function addUtcDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function newYorkClock(now = new Date()) {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    weekday: fields.weekday,
    minutes: Number(fields.hour) * 60 + Number(fields.minute),
  };
}

export function parseClockTime(value, fallback = '16:30') {
  const parse = (candidate) => {
    const match = String(candidate || '').match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
  };
  return parse(value) ?? parse(fallback) ?? 16 * 60 + 30;
}

export function previousWeekday(date) {
  let candidate = addUtcDays(date, -1);
  while ([0, 6].includes(new Date(`${candidate}T00:00:00Z`).getUTCDay()))
    candidate = addUtcDays(candidate, -1);
  return candidate;
}

export function latestScheduledWeekday(now = new Date(), time = '16:30') {
  const clock = newYorkClock(now);
  const weekday = new Date(`${clock.date}T00:00:00Z`).getUTCDay();
  if (weekday >= 1 && weekday <= 5 && clock.minutes >= parseClockTime(time))
    return clock.date;
  return previousWeekday(clock.date);
}

export function usTradingSession(now = new Date()) {
  const { date, minutes } = newYorkClock(now);
  if (minutes >= 20 * 60)
    return { key: 'overnight', label: '隔夜盘', date: addUtcDays(date, 1) };
  if (minutes < 4 * 60) return { key: 'overnight', label: '隔夜盘', date };
  if (minutes < 9 * 60 + 30)
    return { key: 'pre_market', label: '盘前', date };
  if (minutes < 16 * 60) return { key: 'regular', label: '常规盘', date };
  return { key: 'post_market', label: '盘后', date };
}

export function usTradingDate(now = new Date()) {
  return usTradingSession(now).date;
}
