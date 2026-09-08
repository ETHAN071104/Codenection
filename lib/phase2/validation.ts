import type {
  DestinationSuggestion,
  GeographicScope,
  GeographicScopeDay,
  SearchStrategy,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

export function parseDestinationSuggestion(
  value: unknown,
): DestinationSuggestion | null {
  if (!isRecord(value)) return null;
  const destination = cleanText(value.destination, 120);
  const reason = cleanText(value.reason, 320);
  const inputWasSpecific = value.inputWasSpecific;
  return destination && reason && typeof inputWasSpecific === 'boolean'
    ? { destination, reason, inputWasSpecific }
    : null;
}

export function parseSearchStrategy(value: unknown): SearchStrategy | null {
  if (!isRecord(value) || !Array.isArray(value.searches)) return null;

  const searches = value.searches
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const query = cleanText(entry.query, 120);
      const category = cleanText(entry.category, 40);
      const desiredCount = Number(entry.desiredCount);
      if (
        !query ||
        !category ||
        !Number.isInteger(desiredCount) ||
        desiredCount < 3 ||
        desiredCount > 8
      ) {
        return null;
      }
      return { query, category, desiredCount };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const deduplicated = Array.from(
    new Map(
      searches.map((search) => [search.query.toLocaleLowerCase(), search]),
    ).values(),
  ).slice(0, 4);

  return deduplicated.length > 0 ? { searches: deduplicated } : null;
}

export function parseGeographicScope(
  value: unknown,
  durationDays: number,
): GeographicScope | null {
  if (!isRecord(value) || !Array.isArray(value.days)) return null;
  const baseDestination = cleanText(value.baseDestination, 120);
  if (!baseDestination) return null;

  const seenDays = new Set<number>();
  const days = value.days
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const day = Number(entry.day);
      const area = cleanText(entry.area, 120);
      const mode = entry.mode;
      if (
        !Number.isInteger(day) ||
        day < 1 ||
        day > durationDays ||
        seenDays.has(day) ||
        !area ||
        (mode !== 'base' && mode !== 'day_trip')
      ) {
        return null;
      }
      seenDays.add(day);
      return { day, area, mode } satisfies GeographicScopeDay;
    })
    .filter((day): day is GeographicScopeDay => day !== null)
    .sort((a, b) => a.day - b.day);

  if (
    days.length !== durationDays ||
    days.some((entry, index) => entry.day !== index + 1) ||
    new Set(days.map((entry) => entry.area.toLocaleLowerCase())).size > 4
  ) {
    return null;
  }

  return { baseDestination, days };
}
