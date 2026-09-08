export type WeeklyOpeningPeriod = {
  openDay: number;
  openMinutes: number;
  closeDay: number | null;
  closeMinutes: number | null;
};

export type OpeningHoursFit = {
  startMinutes: number;
  openingHoursKnown: boolean;
  shiftedToOpening: boolean;
  closesAtMinutes: number | null;
};

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

function validDay(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

function clockMinutes(hour: unknown, minute: unknown) {
  const normalizedHour = Number(hour ?? 0);
  const normalizedMinute = Number(minute ?? 0);
  return Number.isInteger(normalizedHour) &&
    normalizedHour >= 0 &&
    normalizedHour <= 23 &&
    Number.isInteger(normalizedMinute) &&
    normalizedMinute >= 0 &&
    normalizedMinute <= 59
    ? normalizedHour * 60 + normalizedMinute
    : null;
}

export function normalizeGoogleOpeningPeriods(
  value: unknown,
): WeeklyOpeningPeriod[] | null {
  if (!Array.isArray(value)) return null;
  const periods: WeeklyOpeningPeriod[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || !('open' in entry)) return null;
    const open = entry.open;
    if (!open || typeof open !== 'object') return null;
    const openDay = 'day' in open ? open.day : null;
    const openMinutes = clockMinutes(
      'hour' in open ? open.hour : 0,
      'minute' in open ? open.minute : 0,
    );
    if (!validDay(openDay) || openMinutes === null) return null;

    const close = 'close' in entry ? entry.close : null;
    if (close === null || close === undefined) {
      periods.push({ openDay, openMinutes, closeDay: null, closeMinutes: null });
      continue;
    }
    if (!close || typeof close !== 'object') return null;
    const closeDay = 'day' in close ? close.day : null;
    const closeMinutes = clockMinutes(
      'hour' in close ? close.hour : 0,
      'minute' in close ? close.minute : 0,
    );
    if (!validDay(closeDay) || closeMinutes === null) return null;
    periods.push({ openDay, openMinutes, closeDay, closeMinutes });
  }
  return periods;
}

export function parseStoredOpeningPeriods(
  value: unknown,
): WeeklyOpeningPeriod[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const periods: WeeklyOpeningPeriod[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const candidate = entry as Record<string, unknown>;
    if (
      !validDay(candidate.openDay) ||
      !Number.isInteger(candidate.openMinutes) ||
      Number(candidate.openMinutes) < 0 ||
      Number(candidate.openMinutes) >= MINUTES_PER_DAY
    ) {
      return null;
    }
    const hasClose =
      candidate.closeDay !== null && candidate.closeMinutes !== null;
    if (
      hasClose &&
      (!validDay(candidate.closeDay) ||
        !Number.isInteger(candidate.closeMinutes) ||
        Number(candidate.closeMinutes) < 0 ||
        Number(candidate.closeMinutes) >= MINUTES_PER_DAY)
    ) {
      return null;
    }
    periods.push({
      openDay: candidate.openDay,
      openMinutes: Number(candidate.openMinutes),
      closeDay: hasClose ? Number(candidate.closeDay) : null,
      closeMinutes: hasClose ? Number(candidate.closeMinutes) : null,
    });
  }
  return periods;
}

export function tripDayOfWeek(
  startDate: string | null | undefined,
  day: number,
) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + day - 1);
  return date.getUTCDay();
}

export function findOpeningHoursFit({
  periods,
  dayOfWeek,
  earliestStartMinutes,
  durationMinutes,
  latestEndMinutes,
}: {
  periods: WeeklyOpeningPeriod[] | null | undefined;
  dayOfWeek: number | null;
  earliestStartMinutes: number;
  durationMinutes: number;
  latestEndMinutes: number;
}): OpeningHoursFit | null {
  if (periods === null || periods === undefined || dayOfWeek === null) {
    return earliestStartMinutes + durationMinutes <= latestEndMinutes
      ? {
          startMinutes: earliestStartMinutes,
          openingHoursKnown: false,
          shiftedToOpening: false,
          closesAtMinutes: null,
        }
      : null;
  }
  if (!periods.length) return null;

  const dayStart = dayOfWeek * MINUTES_PER_DAY;
  const requestedStart = dayStart + earliestStartMinutes;
  const requestedEnd = dayStart + latestEndMinutes;
  let best: OpeningHoursFit | null = null;

  for (const period of periods) {
    if (period.closeDay === null || period.closeMinutes === null) {
      return {
        startMinutes: earliestStartMinutes,
        openingHoursKnown: true,
        shiftedToOpening: false,
        closesAtMinutes: null,
      };
    }
    const open = period.openDay * MINUTES_PER_DAY + period.openMinutes;
    let close = period.closeDay * MINUTES_PER_DAY + period.closeMinutes;
    if (close <= open) close += MINUTES_PER_WEEK;

    for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
      const shiftedOpen = open + shift;
      const shiftedClose = close + shift;
      const candidateStart = Math.max(requestedStart, shiftedOpen);
      if (
        candidateStart + durationMinutes > shiftedClose ||
        candidateStart + durationMinutes > requestedEnd
      ) {
        continue;
      }
      const fit = {
        startMinutes: candidateStart - dayStart,
        openingHoursKnown: true,
        shiftedToOpening: candidateStart > requestedStart,
        closesAtMinutes: shiftedClose - dayStart,
      };
      if (!best || fit.startMinutes < best.startMinutes) best = fit;
    }
  }
  return best;
}
