export const DEFAULT_TRIP_DAYS = 3;
export const MAX_TRIP_DAYS = 30;

export function formatTripDuration(days: number | null | undefined) {
  if (!Number.isInteger(days) || !days || days < 1) return null;
  return `${days}D${days - 1}N`;
}

export function parseTripDuration(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;

  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= MAX_TRIP_DAYS
    ? days
    : null;
}
