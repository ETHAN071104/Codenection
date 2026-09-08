import {
  approximateTransitionMinutes,
  centroidForArea,
  type DeterministicDraftSchedule,
  type DeterministicScheduleConstraints,
} from './deterministic-scheduling-core';
import { findOpeningHoursFit, tripDayOfWeek } from './opening-hours-core';
import { derivePaceProfile } from './pace-profile-core';
import type { RouteValidationStatus } from './route-validation-core';
import type { CandidatePlace } from './types';
import { parseTimeMinutes } from '@/lib/trips/travel-boundaries';

export type FinalFeasibilityReason =
  | 'INVALID_IDENTITY'
  | 'INVALID_TIME'
  | 'INVALID_DURATION'
  | 'DAILY_WINDOW'
  | 'OPENING_HOURS_CONFLICT'
  | 'ARRIVAL_BOUNDARY'
  | 'DEPARTURE_BOUNDARY'
  | 'RETURN_TO_STAY'
  | 'ROUTE_DURATION'
  | 'OVERLAP'
  | 'DUPLICATE_PLACE'
  | 'UNACCOUNTED_SELECTED_PLACE';

export type FinalFeasibilityIssue = {
  code: FinalFeasibilityReason;
  day: number | null;
  placeId: string | null;
  message: string;
};

export type FinalFeasibilityResult = {
  status: 'PASS' | 'REPAIRED' | 'FAIL';
  issues: FinalFeasibilityIssue[];
  budgetEvidence: 'known' | 'partial' | 'insufficient';
  selectedCount: number;
  scheduledCount: number;
  overflowCount: number;
  routeStatus: RouteValidationStatus['status'] | 'local_haversine';
};

type FinalSchedule = DeterministicDraftSchedule & {
  routeValidation?: RouteValidationStatus;
};

function validCoordinate(value: number | null, maximum: number) {
  return value !== null && Number.isFinite(value) && Math.abs(value) <= maximum;
}

function addIssue(
  issues: FinalFeasibilityIssue[],
  issue: FinalFeasibilityIssue,
) {
  if (
    !issues.some(
      (existing) =>
        existing.code === issue.code &&
        existing.day === issue.day &&
        existing.placeId === issue.placeId,
    )
  ) {
    issues.push(issue);
  }
}

function budgetEvidence(selected: CandidatePlace[]) {
  const known = selected.filter(
    (place) => place.priceLevel !== null || place.budgetScore !== null,
  ).length;
  return known === 0
    ? ('insufficient' as const)
    : known === selected.length
      ? ('known' as const)
      : ('partial' as const);
}

/**
 * Final deterministic gate for the collaborative itinerary only. It validates
 * hard feasibility and reports soft budget evidence without changing ranking.
 */
export function validateFinalCollaborativeItinerary({
  schedule,
  selected,
  candidates,
  recommendedStayArea,
  constraints,
}: {
  schedule: FinalSchedule;
  selected: CandidatePlace[];
  candidates: CandidatePlace[];
  recommendedStayArea: string | null;
  constraints?: DeterministicScheduleConstraints;
}): FinalFeasibilityResult {
  const issues: FinalFeasibilityIssue[] = [];
  const candidateById = new Map(candidates.map((place) => [place.id, place]));
  const selectedById = new Map(selected.map((place) => [place.id, place]));
  const selectedStateCount = new Map<string, number>();
  const seenScheduledIds = new Set<string>();
  const seenGoogleIds = new Set<string>();
  const profile = derivePaceProfile(constraints?.averagePace);
  const stay = centroidForArea(recommendedStayArea, candidates);
  const routeDays = new Map(
    schedule.routeValidation?.days.map((day) => [day.day, day]) ?? [],
  );

  if (selectedById.size !== selected.length) {
    addIssue(issues, {
      code: 'DUPLICATE_PLACE',
      day: null,
      placeId: null,
      message: 'The selected-place collection contains duplicate rows.',
    });
  }

  for (const day of schedule.days) {
    const dayStart = parseTimeMinutes(day.startTime);
    const dayEnd = parseTimeMinutes(day.endTime);
    const firstDay = day.day === 1;
    const finalDay = day.day === schedule.days.length;
    const arrivalBoundary = firstDay
      ? parseTimeMinutes(constraints?.arrivalTime)
      : null;
    const departureBoundary = finalDay
      ? parseTimeMinutes(constraints?.departureTime)
      : null;
    const expectedStart = Math.max(
      profile.earliestActivityMinutes,
      arrivalBoundary ?? profile.earliestActivityMinutes,
    );
    const expectedEnd = Math.min(
      profile.targetReturnMinutes,
      departureBoundary ?? profile.targetReturnMinutes,
    );
    if (
      dayStart === null ||
      dayEnd === null ||
      dayStart > dayEnd ||
      dayStart < expectedStart ||
      dayEnd > expectedEnd
    ) {
      addIssue(issues, {
        code: 'DAILY_WINDOW',
        day: day.day,
        placeId: null,
        message: 'The day has an invalid Pace-based planning window.',
      });
    }

    let previousEnd = dayStart;
    for (const [index, item] of day.items.entries()) {
      selectedStateCount.set(
        item.placeId,
        (selectedStateCount.get(item.placeId) ?? 0) + 1,
      );
      const candidate = candidateById.get(item.placeId);
      if (
        !candidate ||
        !item.placeId ||
        !candidate.googlePlaceId?.trim() ||
        !validCoordinate(candidate.latitude, 90) ||
        !validCoordinate(candidate.longitude, 180)
      ) {
        addIssue(issues, {
          code: 'INVALID_IDENTITY',
          day: day.day,
          placeId: item.placeId || null,
          message: `${item.name} is not a grounded routable place.`,
        });
      }
      if (seenScheduledIds.has(item.placeId)) {
        addIssue(issues, {
          code: 'DUPLICATE_PLACE',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} appears more than once in the itinerary.`,
        });
      }
      seenScheduledIds.add(item.placeId);
      const googleId = candidate?.googlePlaceId?.trim();
      if (googleId && seenGoogleIds.has(googleId)) {
        addIssue(issues, {
          code: 'DUPLICATE_PLACE',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} duplicates another Google Place.`,
        });
      }
      if (googleId) seenGoogleIds.add(googleId);

      const start = parseTimeMinutes(item.startTime);
      const end = parseTimeMinutes(item.endTime);
      if (start === null || end === null || end <= start) {
        addIssue(issues, {
          code: 'INVALID_TIME',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} has an invalid planned time.`,
        });
        continue;
      }
      if (
        !Number.isInteger(item.durationMinutes) ||
        item.durationMinutes < 15 ||
        item.durationMinutes > 720 ||
        end - start !== item.durationMinutes
      ) {
        addIssue(issues, {
          code: 'INVALID_DURATION',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} has an invalid visit duration.`,
        });
      }
      if (
        !Number.isInteger(item.estimatedTransitionMinutesBefore) ||
        item.estimatedTransitionMinutesBefore < 0
      ) {
        addIssue(issues, {
          code: 'ROUTE_DURATION',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} has an invalid preceding route duration.`,
        });
      }
      if (previousEnd !== null && start < previousEnd) {
        addIssue(issues, {
          code: 'OVERLAP',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} overlaps the previous activity.`,
        });
      }
      if (
        previousEnd !== null &&
        start < previousEnd + item.estimatedTransitionMinutesBefore
      ) {
        addIssue(issues, {
          code:
            index === 0 && arrivalBoundary !== null
              ? 'ARRIVAL_BOUNDARY'
              : 'ROUTE_DURATION',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} does not leave enough time for its preceding route.`,
        });
      }
      if (start < expectedStart) {
        addIssue(issues, {
          code:
            firstDay && arrivalBoundary !== null
              ? 'ARRIVAL_BOUNDARY'
              : 'DAILY_WINDOW',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} starts before the allowed daily boundary.`,
        });
      }
      if (end > expectedEnd) {
        addIssue(issues, {
          code:
            finalDay && departureBoundary !== null
              ? 'DEPARTURE_BOUNDARY'
              : 'DAILY_WINDOW',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} ends after the allowed daily boundary.`,
        });
      }
      if (candidate) {
        const weekday = tripDayOfWeek(constraints?.startDate, day.day);
        const openingFit = findOpeningHoursFit({
          periods: candidate.openingPeriods,
          dayOfWeek: weekday,
          earliestStartMinutes: start,
          durationMinutes: item.durationMinutes,
          latestEndMinutes: end,
        });
        if (!openingFit || openingFit.startMinutes !== start) {
          addIssue(issues, {
            code: 'OPENING_HOURS_CONFLICT',
            day: day.day,
            placeId: item.placeId,
            message: `${item.name} is outside its known opening hours.`,
          });
        }
      }
      previousEnd = end;
    }

    for (const overflow of day.overflow) {
      selectedStateCount.set(
        overflow.placeId,
        (selectedStateCount.get(overflow.placeId) ?? 0) + 1,
      );
    }

    const lastItem = day.items.at(-1);
    const lastCandidate = lastItem
      ? candidateById.get(lastItem.placeId) ?? null
      : null;
    const returnTarget = finalDay
      ? constraints?.departurePoint ?? stay
      : stay;
    if (lastItem && lastCandidate && returnTarget && dayEnd !== null) {
      const routeDay = routeDays.get(day.day);
      const lastCoordinate =
        validCoordinate(lastCandidate.latitude, 90) &&
        validCoordinate(lastCandidate.longitude, 180)
          ? {
              latitude: lastCandidate.latitude as number,
              longitude: lastCandidate.longitude as number,
            }
          : null;
      const fallbackReturn = approximateTransitionMinutes(
        lastCoordinate,
        returnTarget,
        profile,
      );
      const returnMinutes =
        routeDay?.status === 'validated' &&
        routeDay.returnTransitionMinutes !== null &&
        routeDay.returnTransitionMinutes !== undefined
          ? routeDay.returnTransitionMinutes
          : fallbackReturn;
      const lastEnd = parseTimeMinutes(lastItem.endTime);
      if (lastEnd !== null && lastEnd + returnMinutes > dayEnd) {
        addIssue(issues, {
          code:
            finalDay && constraints?.departurePoint
              ? 'DEPARTURE_BOUNDARY'
              : 'RETURN_TO_STAY',
          day: day.day,
          placeId: lastItem.placeId,
          message:
            finalDay && constraints?.departurePoint
              ? 'The final activity leaves insufficient airport transfer time.'
              : 'The final activity leaves insufficient time to return toward the stay area.',
        });
      }
      if (
        routeDay?.status === 'validated' &&
        routeDay.routeDurationMinutes !== null &&
        routeDay.routeDurationMinutes !== undefined &&
        routeDay.routeDurationMinutes > expectedEnd - expectedStart
      ) {
        addIssue(issues, {
          code: 'ROUTE_DURATION',
          day: day.day,
          placeId: null,
          message: 'The validated road route exceeds the available daily window.',
        });
      }
    }
  }

  for (const place of selected) {
    if ((selectedStateCount.get(place.id) ?? 0) !== 1) {
      addIssue(issues, {
        code: 'UNACCOUNTED_SELECTED_PLACE',
        day: null,
        placeId: place.id,
        message: `${place.name} must be scheduled or intentionally optional exactly once.`,
      });
    }
  }
  for (const [placeId] of selectedStateCount) {
    if (!selectedById.has(placeId)) {
      addIssue(issues, {
        code: 'UNACCOUNTED_SELECTED_PLACE',
        day: null,
        placeId,
        message: 'The schedule contains a place the group did not select.',
      });
    }
  }

  const scheduledCount = schedule.days.reduce(
    (sum, day) => sum + day.items.length,
    0,
  );
  const overflowCount = schedule.days.reduce(
    (sum, day) => sum + day.overflow.length,
    0,
  );
  if (
    schedule.scheduledPlaceCount !== scheduledCount ||
    schedule.overflowPlaceCount !== overflowCount ||
    scheduledCount + overflowCount !== selected.length
  ) {
    addIssue(issues, {
      code: 'UNACCOUNTED_SELECTED_PLACE',
      day: null,
      placeId: null,
      message:
        'Selected, scheduled, and Optional place counts do not reconcile.',
    });
  }
  const repaired =
    overflowCount > 0 || schedule.routeValidation?.repaired === true;
  return {
    status: issues.length ? 'FAIL' : repaired ? 'REPAIRED' : 'PASS',
    issues,
    budgetEvidence: budgetEvidence(selected),
    selectedCount: selected.length,
    scheduledCount,
    overflowCount,
    routeStatus:
      schedule.routeValidation?.status ?? 'local_haversine',
  };
}

export async function persistIfFinalFeasible<Value>(
  validation: FinalFeasibilityResult,
  persist: () => PromiseLike<Value>,
) {
  if (validation.status === 'FAIL') {
    return { persisted: false as const };
  }
  return { persisted: true as const, value: await persist() };
}
