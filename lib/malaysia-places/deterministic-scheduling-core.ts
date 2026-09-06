import { haversineDistanceKm, type DayClusterSelection, type GeographicDayClustering } from './day-clustering-core';
import type { CandidatePlace } from './types';
import {
  compareConsensusPriority,
  consensusPriorityTier,
} from './consensus-core';

export const DRAFT_SCHEDULE_WINDOW = {
  startMinutes: 9 * 60,
  endMinutes: 21 * 60,
  lunch: { startMinutes: 12 * 60, endMinutes: 14 * 60, durationMinutes: 60 },
  dinner: { startMinutes: 18 * 60, endMinutes: 20 * 60, durationMinutes: 60 },
} as const;

const CATEGORY_DURATION_MINUTES: Record<string, number> = {
  aquarium: 120,
  art_museum: 120,
  botanical_garden: 120,
  historical_landmark: 90,
  market: 90,
  museum: 120,
  park: 120,
  shopping_mall: 120,
  tourist_attraction: 90,
  wildlife_park: 120,
};

const DEFAULT_DURATION_MINUTES = 90;

type Coordinate = { latitude: number; longitude: number };

export type DraftScheduleItem = {
  placeId: string;
  name: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  estimatedTransitionMinutesBefore: number;
  schedulingReasons: string[];
};

export type DraftScheduleBreak = {
  label: 'Lunch / break' | 'Dinner / break';
  startTime: string;
  endTime: string;
  durationMinutes: number;
  reason: string;
};

export type DraftScheduleOverflow = {
  placeId: string;
  name: string;
  durationMinutes: number;
  reason: string;
};

export type DraftScheduleDay = {
  day: number;
  startTime: string;
  endTime: string;
  items: DraftScheduleItem[];
  breaks: DraftScheduleBreak[];
  overflow: DraftScheduleOverflow[];
};

export type DeterministicDraftSchedule = {
  status: 'ready' | 'no_selection';
  days: DraftScheduleDay[];
  scheduledPlaceCount: number;
  overflowPlaceCount: number;
  unlocatedPlaceCount: number;
};

function hasCoordinates(place: Pick<CandidatePlace, 'latitude' | 'longitude'>): place is Pick<CandidatePlace, 'latitude' | 'longitude'> & Coordinate {
  return place.latitude !== null && place.longitude !== null;
}

function time(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function comparePriority(a: DayClusterSelection, b: DayClusterSelection) {
  return compareConsensusPriority(a, b);
}

function bestTimeRank(place: DayClusterSelection) {
  switch (place.bestTimeOfDay?.toLowerCase()) {
    case 'morning': return 0;
    case 'any': return 1;
    case 'afternoon': return 2;
    case 'evening': return 3;
    default: return 1;
  }
}

function preferredStart(place: DayClusterSelection) {
  switch (place.bestTimeOfDay?.toLowerCase()) {
    case 'afternoon': return 13 * 60;
    case 'evening': return 17 * 60 + 30;
    default: return DRAFT_SCHEDULE_WINDOW.startMinutes;
  }
}

function durationFor(place: DayClusterSelection) {
  if (place.estimatedDurationMinutes && place.estimatedDurationMinutes > 0) {
    return { minutes: place.estimatedDurationMinutes, source: 'saved visit duration' };
  }
  const category = place.category?.toLowerCase() ?? '';
  return { minutes: CATEGORY_DURATION_MINUTES[category] ?? DEFAULT_DURATION_MINUTES, source: `deterministic ${category || 'general'} category fallback` };
}

function isFoodRelated(place: DayClusterSelection) {
  const values = [place.category, ...place.subcategories].filter(Boolean).join(' ').toLowerCase();
  return /food|market|restaurant|cafe|hawker|dining/.test(values);
}

function transitionMinutes(from: Coordinate | null, to: Coordinate | null) {
  if (!from || !to) return 20;
  const distanceKm = haversineDistanceKm(from, to);
  if (distanceKm <= 1) return 10;
  if (distanceKm <= 3) return 20;
  if (distanceKm <= 8) return 35;
  return 50;
}

function centroidForArea(area: string | null, knownPlaces: CandidatePlace[]): Coordinate | null {
  if (!area) return null;
  const places = knownPlaces.filter((place): place is CandidatePlace & Coordinate => place.area === area && hasCoordinates(place));
  if (!places.length) return null;
  return {
    latitude: places.reduce((sum, place) => sum + place.latitude, 0) / places.length,
    longitude: places.reduce((sum, place) => sum + place.longitude, 0) / places.length,
  };
}

function fallbackOrigin(places: DayClusterSelection[]): Coordinate | null {
  const located = places.filter((place): place is DayClusterSelection & Coordinate => hasCoordinates(place));
  if (!located.length) return null;
  return {
    latitude: located.reduce((sum, place) => sum + place.latitude, 0) / located.length,
    longitude: located.reduce((sum, place) => sum + place.longitude, 0) / located.length,
  };
}

function orderedPlaces(places: DayClusterSelection[], origin: Coordinate | null) {
  let prior = origin;
  const remaining = [...places];
  const ordered: DayClusterSelection[] = [];
  while (remaining.length) {
    remaining.sort((a, b) => {
      const consensusOrder = comparePriority(a, b);
      const aTier = consensusPriorityTier(a.voteCount, a.totalMembers);
      const bTier = consensusPriorityTier(b.voteCount, b.totalMembers);
      if (aTier !== bTier) return consensusOrder;
      const timeOrder = bestTimeRank(a) - bestTimeRank(b);
      if (timeOrder) return timeOrder;
      const aDistance = prior && hasCoordinates(a) ? haversineDistanceKm(prior, a) : Number.POSITIVE_INFINITY;
      const bDistance = prior && hasCoordinates(b) ? haversineDistanceKm(prior, b) : Number.POSITIVE_INFINITY;
      return aDistance - bDistance || comparePriority(a, b);
    });
    const next = remaining.shift()!;
    ordered.push(next);
    if (hasCoordinates(next)) prior = next;
  }
  return ordered;
}

function addBreakIfNeeded(
  breaks: DraftScheduleBreak[],
  current: number,
  plannedStart: number,
  place: DayClusterSelection,
): number {
  if (isFoodRelated(place)) return current;
  const meals: Array<{ label: DraftScheduleBreak['label']; startMinutes: number; endMinutes: number; durationMinutes: number }> = [
    { label: 'Lunch / break', ...DRAFT_SCHEDULE_WINDOW.lunch },
    { label: 'Dinner / break', ...DRAFT_SCHEDULE_WINDOW.dinner },
  ];
  for (const meal of meals) {
    if (breaks.some((item) => item.label === meal.label)) continue;
    if (current > meal.endMinutes || plannedStart >= meal.endMinutes || plannedStart < meal.startMinutes) continue;
    const breakStart = Math.max(current, meal.startMinutes);
    const breakEnd = breakStart + meal.durationMinutes;
    breaks.push({ label: meal.label, startTime: time(breakStart), endTime: time(breakEnd), durationMinutes: meal.durationMinutes, reason: 'A generic meal window is reserved because no selected food stop satisfies it.' });
    return breakEnd;
  }
  return current;
}

/**
 * A route-independent draft schedule. It uses Haversine-derived buffers only;
 * Phase 9F will validate these estimates against actual route times.
 */
export function createDeterministicDraftSchedule(
  grouping: GeographicDayClustering,
  knownPlaces: CandidatePlace[],
  recommendedStayArea: string | null,
): DeterministicDraftSchedule {
  const stayOrigin = centroidForArea(recommendedStayArea, knownPlaces);
  let scheduledPlaceCount = 0;
  let overflowPlaceCount = 0;
  const days = grouping.days.map((group) => {
    const breaks: DraftScheduleBreak[] = [];
    const items: DraftScheduleItem[] = [];
    const overflow: DraftScheduleOverflow[] = [];
    const origin = stayOrigin ?? fallbackOrigin(group.places);
    const ordered = orderedPlaces(group.places, origin);
    let current = DRAFT_SCHEDULE_WINDOW.startMinutes;
    let previous: DayClusterSelection | null = null;
    for (const place of ordered) {
      const duration = durationFor(place);
      const priorCoordinate = previous && hasCoordinates(previous) ? previous : origin;
      const targetCoordinate = hasCoordinates(place) ? place : null;
      const transition = transitionMinutes(priorCoordinate, targetCoordinate);
      let start = Math.max(current + transition, preferredStart(place));
      const afterBreak = addBreakIfNeeded(breaks, current, start, place);
      if (afterBreak !== current) start = Math.max(afterBreak + transition, preferredStart(place));
      if (start + duration.minutes > DRAFT_SCHEDULE_WINDOW.endMinutes) {
        overflow.push({ placeId: place.id, name: place.name, durationMinutes: duration.minutes, reason: 'Could not fit inside the 09:00–21:00 draft window after higher-priority places, estimated buffers, and meal windows.' });
        overflowPlaceCount += 1;
        continue;
      }
      const reasons = [
        `Uses ${duration.source} (${duration.minutes} min).`,
        `Includes an approximate ${transition}-minute Haversine transition buffer; route validation comes next.`,
      ];
      if (place.totalMembers > 0 && place.voteCount >= place.totalMembers) {
        reasons.push('Included first because it is a shared priority for everyone in the group.');
      } else if (place.totalMembers > 0 && place.voteCount * 2 > place.totalMembers) {
        reasons.push('Included early because a majority of the group chose it.');
      } else {
        reasons.push('Included as an individual group member preference after broader shared priorities.');
      }
      const preference = place.bestTimeOfDay?.toLowerCase();
      if (preference && preference !== 'any') reasons.push(`Scheduled later to prefer its ${preference} best-time setting.`);
      if (previous) reasons.push(`Placed after ${previous.name} using geographic proximity and group priority.`);
      else if (recommendedStayArea && stayOrigin) reasons.push(`Day starts from the representative coordinate for the recommended ${recommendedStayArea} stay area.`);
      else reasons.push('Day starts from a deterministic geographic fallback because no stay-area coordinate is available.');
      items.push({ placeId: place.id, name: place.name, startTime: time(start), endTime: time(start + duration.minutes), durationMinutes: duration.minutes, estimatedTransitionMinutesBefore: transition, schedulingReasons: reasons });
      if (isFoodRelated(place)) {
        const itemEnd = start + duration.minutes;
        if (start < DRAFT_SCHEDULE_WINDOW.lunch.endMinutes && itemEnd > DRAFT_SCHEDULE_WINDOW.lunch.startMinutes && !breaks.some((item) => item.label === 'Lunch / break')) {
          breaks.push({ label: 'Lunch / break', startTime: time(start), endTime: time(itemEnd), durationMinutes: duration.minutes, reason: `${place.name} is a selected food-related stop that satisfies the lunch window.` });
        }
        if (start < DRAFT_SCHEDULE_WINDOW.dinner.endMinutes && itemEnd > DRAFT_SCHEDULE_WINDOW.dinner.startMinutes && !breaks.some((item) => item.label === 'Dinner / break')) {
          breaks.push({ label: 'Dinner / break', startTime: time(start), endTime: time(itemEnd), durationMinutes: duration.minutes, reason: `${place.name} is a selected food-related stop that satisfies the dinner window.` });
        }
      }
      current = start + duration.minutes;
      previous = place;
      scheduledPlaceCount += 1;
    }
    return { day: group.day, startTime: time(DRAFT_SCHEDULE_WINDOW.startMinutes), endTime: time(DRAFT_SCHEDULE_WINDOW.endMinutes), items, breaks: breaks.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.label.localeCompare(b.label)), overflow };
  });
  return { status: grouping.status, days, scheduledPlaceCount, overflowPlaceCount, unlocatedPlaceCount: grouping.unlocatedPlaceCount };
}
