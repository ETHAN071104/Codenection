import type { ItineraryItemView } from '@/lib/phase2/types';
import type { TripRoute } from '@/lib/routing/types';

export type PlannedScheduleEntry = {
  itemId: string;
  plannedTime: string;
};

function parseMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null;
}

function formatMinutes(value: number) {
  const bounded = Math.min(Math.max(value, 0), 23 * 60 + 55);
  const hours = Math.floor(bounded / 60);
  const minutes = bounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

export function calculateDaySchedule(
  items: ItineraryItemView[],
  route: TripRoute,
): PlannedScheduleEntry[] {
  if (items.length === 0) return [];

  const existingTimes = items
    .map((item) => parseMinutes(item.plannedTime))
    .filter((value): value is number => value !== null);
  const earliest = existingTimes.length ? Math.min(...existingTimes) : 9 * 60;
  let cursor = earliest >= 6 * 60 && earliest <= 15 * 60 ? earliest : 9 * 60;
  const segments = new Map(
    route.segments.map((segment) => [
      `${segment.fromItemId}:${segment.toItemId}`,
      segment,
    ]),
  );

  return items.map((item, index) => {
    const plannedTime = formatMinutes(cursor);
    const next = items[index + 1];
    if (next) {
      const segment = segments.get(`${item.id}:${next.id}`);
      const travelMinutes = segment
        ? Math.max(0, Math.round(segment.durationSeconds / 60))
        : 0;
      cursor = roundToFive(
        cursor + item.estimatedDurationMinutes + travelMinutes,
      );
    }
    return { itemId: item.id, plannedTime };
  });
}
