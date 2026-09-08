import type { CandidatePlace } from './types';
import {
  approximateTransitionMinutes,
  estimatedVisitDurationMinutes,
} from './deterministic-scheduling-core';
import { derivePaceProfile, type PaceMealWindow } from './pace-profile-core';
import { parseTimeMinutes } from '@/lib/trips/travel-boundaries';

const MINIMUM_RECOMMENDATION_SCORE = 45;
const MAXIMUM_SCORE_DROP = 25;
const MINIMUM_REPRESENTATIVE_STOP_MINUTES = 75;

type ShortlistCapacityOptions = {
  candidates?: CandidatePlace[];
  arrivalTime?: string | null;
  departureTime?: string | null;
};

export function suggestedShortlistSize(
  averagePace: number | null | undefined,
  durationDays: number | null | undefined,
  options: ShortlistCapacityOptions = {},
) {
  const expectedCapacity = estimateTripSchedulableCapacity(
    averagePace,
    durationDays,
    options,
  );
  if (expectedCapacity === 0) return 0;
  const reviewBuffer = Math.min(
    5,
    Math.max(2, Math.ceil(expectedCapacity * 0.25)),
  );
  return expectedCapacity + reviewBuffer;
}

function reservedMealMinutes(
  meal: PaceMealWindow,
  dayStart: number,
  dayEnd: number,
) {
  return dayStart < meal.endMinutes && dayEnd > meal.startMinutes
    ? meal.durationMinutes
    : 0;
}

function representativeStopMinutes(candidates: CandidatePlace[] | undefined) {
  if (!candidates?.length) return 90;
  const durations = candidates
    .map(estimatedVisitDurationMinutes)
    .sort((a, b) => a - b);
  return Math.max(
    MINIMUM_REPRESENTATIVE_STOP_MINUTES,
    durations[Math.floor(durations.length / 2)] ?? 90,
  );
}

export function estimateTripSchedulableCapacity(
  averagePace: number | null | undefined,
  durationDays: number | null | undefined,
  options: ShortlistCapacityOptions = {},
) {
  const profile = derivePaceProfile(averagePace);
  const days = Math.max(1, Math.floor(durationDays ?? 3));
  const arrivalMinutes = parseTimeMinutes(options.arrivalTime);
  const departureMinutes = parseTimeMinutes(options.departureTime);
  const stopMinutes = representativeStopMinutes(options.candidates);
  const transitionMinutes = approximateTransitionMinutes(null, null, profile);
  let capacity = 0;

  for (let day = 1; day <= days; day += 1) {
    const dayStart = Math.max(
      profile.earliestActivityMinutes,
      day === 1
        ? (arrivalMinutes ?? profile.earliestActivityMinutes)
        : profile.earliestActivityMinutes,
    );
    const dayEnd = Math.min(
      profile.targetReturnMinutes,
      day === days
        ? (departureMinutes ?? profile.targetReturnMinutes)
        : profile.targetReturnMinutes,
    );
    const mealMinutes =
      reservedMealMinutes(profile.lunch, dayStart, dayEnd) +
      reservedMealMinutes(profile.dinner, dayStart, dayEnd);
    const usableMinutes = Math.max(0, dayEnd - dayStart - mealMinutes);
    capacity += Math.floor(usableMinutes / (stopMinutes + transitionMinutes));
  }

  return capacity;
}

export function createSuggestedShortlist(
  candidates: CandidatePlace[],
  options: {
    averagePace: number | null | undefined;
    durationDays: number | null | undefined;
    arrivalTime?: string | null;
    departureTime?: string | null;
  },
) {
  const ranked = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      (b.googleRating ?? -1) - (a.googleRating ?? -1) ||
      (b.googleRatingCount ?? -1) - (a.googleRatingCount ?? -1) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  const bestScore = ranked[0]?.score ?? 0;
  const qualityFloor = Math.max(
    MINIMUM_RECOMMENDATION_SCORE,
    bestScore - MAXIMUM_SCORE_DROP,
  );
  return ranked
    .filter((candidate) => candidate.score >= qualityFloor)
    .slice(
      0,
      suggestedShortlistSize(options.averagePace, options.durationDays, {
        candidates: ranked,
        arrivalTime: options.arrivalTime,
        departureTime: options.departureTime,
      }),
    );
}
