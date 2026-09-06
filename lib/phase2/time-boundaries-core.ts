import type {
  PersistedItineraryItem,
  SelectedItinerary,
} from './types';
import { parseTimeMinutes } from '@/lib/trips/travel-boundaries';

const DEFAULT_DAY_START = 9 * 60;
const DEFAULT_DAY_END = 21 * 60;
const BETWEEN_STOPS_MINUTES = 30;

function formatTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function applyTimeBoundariesToGeneratedItinerary(
  itinerary: SelectedItinerary,
  constraints: { arrivalTime: string | null; departureTime: string | null },
): PersistedItineraryItem[] | null {
  const finalDay = itinerary.days.length;
  const arrivalMinutes = parseTimeMinutes(constraints.arrivalTime);
  const departureMinutes = parseTimeMinutes(constraints.departureTime);
  const result: PersistedItineraryItem[] = [];

  for (const day of itinerary.days) {
    let current =
      day.day === 1
        ? Math.max(DEFAULT_DAY_START, arrivalMinutes ?? DEFAULT_DAY_START)
        : DEFAULT_DAY_START;
    const dayEnd =
      day.day === finalDay
        ? Math.min(DEFAULT_DAY_END, departureMinutes ?? DEFAULT_DAY_END)
        : DEFAULT_DAY_END;

    for (const [index, item] of day.items.entries()) {
      if (current + item.estimatedDurationMinutes > dayEnd) return null;
      result.push({
        ...item,
        day: day.day,
        sortOrder: index,
        plannedTime: formatTime(current),
        dayTheme: day.theme,
      });
      current += item.estimatedDurationMinutes + BETWEEN_STOPS_MINUTES;
    }
  }

  return result;
}
