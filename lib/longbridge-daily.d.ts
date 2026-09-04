export function validateLongbridgeDailyWindow(
  raw: { start_date?: string; end_date?: string } | null | undefined,
  date: string,
  now?: Date,
): { valid: boolean; reason: string | null };
