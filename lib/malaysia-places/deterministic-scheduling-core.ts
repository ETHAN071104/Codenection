import {
  haversineDistanceKm,
  type DayClusterSelection,
  type GeographicDayClustering,
} from './day-clustering-core';
import type { CandidatePlace } from './types';
import {
  compareSelectionPriority,
  isRecommendationPriority,
  selectionPriorityTier,
} from './selection-priority-core';
import {
  parseTimeMinutes,
  type TripTimeConstraints,
} from '@/lib/trips/travel-boundaries';
import { derivePaceProfile, type PaceProfile } from './pace-profile-core';
import {
  classifyPlaceTiming,
  daypartForTime,
  daypartWindow,
  type PlaceTimingProfile,
  type PlanningDaypart,
} from './daypart-fit-core';
import {
  findOpeningHoursFit,
  tripDayOfWeek,
  type OpeningHoursFit,
} from './opening-hours-core';

const CATEGORY_DURATION_MINUTES: Record<string, number> = {
  aquarium: 120,
  art_museum: 120,
  botanical_garden: 120,
  historical_landmark: 90,
  bakery: 45,
  cafe: 60,
  coffee_shop: 60,
  food_court: 60,
  market: 90,
  museum: 120,
  park: 120,
  restaurant: 75,
  shopping_mall: 120,
  tourist_attraction: 90,
  wildlife_park: 120,
};

const DEFAULT_DURATION_MINUTES = 90;
const CROSS_AREA_TRANSITION_PENALTY_KM = 12;
const DAYPART_INVERSION_PENALTY_KM = 4;
const CONSENSUS_ORDER_PENALTY_KM = 6;

export const ROUTE_START_ANCHOR_ID = 'planning-start-anchor';
export const ROUTE_END_ANCHOR_ID = 'planning-end-anchor';

type Coordinate = { latitude: number; longitude: number };

export type DeterministicScheduleConstraints = TripTimeConstraints & {
  averagePace?: number | null;
  startDate?: string | null;
};

export type RouteDurationOverrides = Record<number, Record<string, number>>;

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

function hasCoordinates(
  place: Pick<CandidatePlace, 'latitude' | 'longitude'>,
): place is Pick<CandidatePlace, 'latitude' | 'longitude'> & Coordinate {
  return place.latitude !== null && place.longitude !== null;
}

function time(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function comparePriority(a: DayClusterSelection, b: DayClusterSelection) {
  return compareSelectionPriority(a, b);
}

function daypartRank(place: DayClusterSelection) {
  const order: Record<PlanningDaypart, number> = {
    morning: 0,
    lunch: 1,
    afternoon: 2,
    dinner: 3,
    evening: 4,
  };
  return order[classifyPlaceTiming(place).preferredDayparts[0]];
}

function openingDeadline(place: DayClusterSelection, dayOfWeek: number | null) {
  const fit = findOpeningHoursFit({
    periods: place.openingPeriods,
    dayOfWeek,
    earliestStartMinutes: 0,
    durationMinutes: 1,
    latestEndMinutes: 24 * 60,
  });
  return fit?.openingHoursKnown ? fit.closesAtMinutes : null;
}

function openingUrgencyScore(
  place: DayClusterSelection,
  dayOfWeek: number | null,
) {
  const deadline = openingDeadline(place, dayOfWeek);
  return deadline !== null && deadline <= 18 * 60
    ? -(18 * 60 - deadline) / 30
    : 0;
}

export function estimatedVisitDurationMinutes(
  place: Pick<CandidatePlace, 'estimatedDurationMinutes' | 'category'>,
) {
  if (place.estimatedDurationMinutes && place.estimatedDurationMinutes > 0) {
    return place.estimatedDurationMinutes;
  }
  const category = place.category?.toLowerCase() ?? '';
  return CATEGORY_DURATION_MINUTES[category] ?? DEFAULT_DURATION_MINUTES;
}

function durationFor(place: DayClusterSelection) {
  if (place.estimatedDurationMinutes && place.estimatedDurationMinutes > 0) {
    return {
      minutes: estimatedVisitDurationMinutes(place),
      source: 'saved visit duration',
    };
  }
  const category = place.category?.toLowerCase() ?? '';
  return {
    minutes: estimatedVisitDurationMinutes(place),
    source: `deterministic ${category || 'general'} category fallback`,
  };
}

export function approximateTransitionMinutes(
  from: Coordinate | null,
  to: Coordinate | null,
  profile: PaceProfile = derivePaceProfile(3),
) {
  let baseMinutes = 20;
  if (from && to) {
    const distanceKm = haversineDistanceKm(from, to);
    if (distanceKm <= 1) baseMinutes = 10;
    else if (distanceKm <= 3) baseMinutes = 20;
    else if (distanceKm <= 8) baseMinutes = 35;
    else baseMinutes = 50;
  }
  return Math.max(
    10,
    Math.ceil((baseMinutes * profile.transitionBufferMultiplier) / 5) * 5,
  );
}

export function centroidForArea(
  area: string | null,
  knownPlaces: CandidatePlace[],
): Coordinate | null {
  if (!area) return null;
  const places = knownPlaces.filter(
    (place): place is CandidatePlace & Coordinate =>
      place.area === area && hasCoordinates(place),
  );
  if (!places.length) return null;
  return {
    latitude:
      places.reduce((sum, place) => sum + place.latitude, 0) / places.length,
    longitude:
      places.reduce((sum, place) => sum + place.longitude, 0) / places.length,
  };
}

function fallbackOrigin(places: DayClusterSelection[]): Coordinate | null {
  const located = places.filter(
    (place): place is DayClusterSelection & Coordinate => hasCoordinates(place),
  );
  if (!located.length) return null;
  return {
    latitude:
      located.reduce((sum, place) => sum + place.latitude, 0) / located.length,
    longitude:
      located.reduce((sum, place) => sum + place.longitude, 0) / located.length,
  };
}

export function routeDurationKey(fromId: string, toId: string) {
  return `${fromId}\u0000${toId}`;
}

function areaTransitionPenalty(
  from: DayClusterSelection | null,
  to: DayClusterSelection,
) {
  return from?.area && to.area && from.area !== to.area
    ? CROSS_AREA_TRANSITION_PENALTY_KM
    : 0;
}

function routeCost(
  places: DayClusterSelection[],
  origin: Coordinate | null,
  end: Coordinate | null,
  dayOfWeek: number | null,
) {
  let cost = 0;
  let priorCoordinate = origin;
  let priorPlace: DayClusterSelection | null = null;
  for (const place of places) {
    if (priorCoordinate && hasCoordinates(place)) {
      cost += haversineDistanceKm(priorCoordinate, place);
    } else if (!hasCoordinates(place)) {
      cost += CROSS_AREA_TRANSITION_PENALTY_KM;
    }
    cost += areaTransitionPenalty(priorPlace, place);
    if (priorPlace && daypartRank(priorPlace) > daypartRank(place)) {
      cost += DAYPART_INVERSION_PENALTY_KM;
    }
    if (
      priorPlace &&
      selectionPriorityTier(priorPlace) > selectionPriorityTier(place)
    ) {
      cost += CONSENSUS_ORDER_PENALTY_KM;
    }
    const priorDeadline = priorPlace
      ? openingDeadline(priorPlace, dayOfWeek)
      : null;
    const nextDeadline = openingDeadline(place, dayOfWeek);
    if (
      priorDeadline !== null &&
      nextDeadline !== null &&
      nextDeadline < priorDeadline &&
      nextDeadline <= 18 * 60
    ) {
      cost += CROSS_AREA_TRANSITION_PENALTY_KM;
    }
    if (hasCoordinates(place)) priorCoordinate = place;
    priorPlace = place;
  }
  if (priorCoordinate && end) cost += haversineDistanceKm(priorCoordinate, end);
  return cost;
}

function improveRouteWithinConsensusTiers(
  places: DayClusterSelection[],
  origin: Coordinate | null,
  end: Coordinate | null,
  dayOfWeek: number | null,
) {
  let improved = [...places];
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    for (let start = 0; start < improved.length - 1; start += 1) {
      for (let finish = start + 1; finish < improved.length; finish += 1) {
        const candidate = [
          ...improved.slice(0, start),
          ...improved.slice(start, finish + 1).reverse(),
          ...improved.slice(finish + 1),
        ];
        if (
          routeCost(candidate, origin, end, dayOfWeek) + 0.001 <
          routeCost(improved, origin, end, dayOfWeek)
        ) {
          improved = candidate;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return improved;
}

export function orderedPlaces(
  places: DayClusterSelection[],
  origin: Coordinate | null,
  end: Coordinate | null,
  dayOfWeek: number | null = null,
) {
  let prior = origin;
  let priorPlace: DayClusterSelection | null = null;
  const remaining = [...places];
  const ordered: DayClusterSelection[] = [];
  while (remaining.length) {
    remaining.sort((a, b) => {
      const aTier = selectionPriorityTier(a);
      const bTier = selectionPriorityTier(b);
      const aDistance =
        prior && hasCoordinates(a)
          ? haversineDistanceKm(prior, a)
          : Number.POSITIVE_INFINITY;
      const bDistance =
        prior && hasCoordinates(b)
          ? haversineDistanceKm(prior, b)
          : Number.POSITIVE_INFINITY;
      const remainingCount = Math.max(1, remaining.length);
      const aEndDistance =
        end && hasCoordinates(a)
          ? haversineDistanceKm(a, end) / remainingCount
          : 0;
      const bEndDistance =
        end && hasCoordinates(b)
          ? haversineDistanceKm(b, end) / remainingCount
          : 0;
      const aScore =
        aDistance +
        areaTransitionPenalty(priorPlace, a) +
        aEndDistance +
        daypartRank(a) * 1.5 +
        openingUrgencyScore(a, dayOfWeek) +
        aTier * 3;
      const bScore =
        bDistance +
        areaTransitionPenalty(priorPlace, b) +
        bEndDistance +
        daypartRank(b) * 1.5 +
        openingUrgencyScore(b, dayOfWeek) +
        bTier * 3;
      return aScore - bScore || comparePriority(a, b);
    });
    const next = remaining.shift()!;
    ordered.push(next);
    if (hasCoordinates(next)) prior = next;
    priorPlace = next;
  }
  return improveRouteWithinConsensusTiers(ordered, origin, end, dayOfWeek);
}

type FeasibleSlot = OpeningHoursFit & {
  daypart: PlanningDaypart;
  preferredDaypart: boolean;
};

function feasibleSlot(
  place: DayClusterSelection,
  timing: PlaceTimingProfile,
  earliestStartMinutes: number,
  durationMinutes: number,
  latestEndMinutes: number,
  dayOfWeek: number | null,
  profile: PaceProfile,
): FeasibleSlot | null {
  for (const daypart of timing.preferredDayparts) {
    const window = daypartWindow(daypart, profile);
    const earliest = Math.max(earliestStartMinutes, window.startMinutes);
    if (earliest >= window.endMinutes) continue;
    const fit = findOpeningHoursFit({
      periods: place.openingPeriods,
      dayOfWeek,
      earliestStartMinutes: earliest,
      durationMinutes,
      latestEndMinutes,
    });
    if (fit && fit.startMinutes < window.endMinutes) {
      return { ...fit, daypart, preferredDaypart: true };
    }
  }

  if (timing.requiresMealWindow) return null;
  const fit = findOpeningHoursFit({
    periods: place.openingPeriods,
    dayOfWeek,
    earliestStartMinutes,
    durationMinutes,
    latestEndMinutes,
  });
  return fit
    ? {
        ...fit,
        daypart: daypartForTime(fit.startMinutes, profile),
        preferredDaypart: false,
      }
    : null;
}

function feasibleSlotAroundBreaks(
  place: DayClusterSelection,
  timing: PlaceTimingProfile,
  earliestStartMinutes: number,
  durationMinutes: number,
  latestEndMinutes: number,
  dayOfWeek: number | null,
  profile: PaceProfile,
  breaks: DraftScheduleBreak[],
) {
  let earliest = earliestStartMinutes;
  while (earliest + durationMinutes <= latestEndMinutes) {
    const slot = feasibleSlot(
      place,
      timing,
      earliest,
      durationMinutes,
      latestEndMinutes,
      dayOfWeek,
      profile,
    );
    if (!slot) return null;
    const conflict = breaks
      .map((item) => ({
        startMinutes: parseTimeMinutes(item.startTime)!,
        endMinutes: parseTimeMinutes(item.endTime)!,
      }))
      .find((item) => overlapsWindow(slot.startMinutes, durationMinutes, item));
    if (!conflict) return slot;
    earliest = conflict.endMinutes;
  }
  return null;
}

function overlapsWindow(
  startMinutes: number,
  durationMinutes: number,
  window: { startMinutes: number; endMinutes: number },
) {
  return (
    startMinutes < window.endMinutes &&
    startMinutes + durationMinutes > window.startMinutes
  );
}

function addBreakIfNeeded(
  breaks: DraftScheduleBreak[],
  current: number,
  plannedStart: number,
  durationMinutes: number,
  timing: PlaceTimingProfile,
  profile: PaceProfile,
): number {
  const meals: Array<{
    label: DraftScheduleBreak['label'];
    meal: 'lunch' | 'dinner';
    startMinutes: number;
    endMinutes: number;
    durationMinutes: number;
  }> = [
    { label: 'Lunch / break', meal: 'lunch', ...profile.lunch },
    { label: 'Dinner / break', meal: 'dinner', ...profile.dinner },
  ];
  let nextCurrent = current;
  for (const meal of meals) {
    if (breaks.some((item) => item.label === meal.label)) continue;
    if (
      timing.mealTypes.includes(meal.meal) &&
      overlapsWindow(plannedStart, durationMinutes, meal)
    ) {
      continue;
    }
    if (
      nextCurrent > meal.endMinutes ||
      plannedStart + durationMinutes <= meal.startMinutes
    ) {
      continue;
    }
    const breakStart = Math.max(nextCurrent, meal.startMinutes);
    const breakEnd = breakStart + meal.durationMinutes;
    if (breakEnd > meal.endMinutes) continue;
    breaks.push({
      label: meal.label,
      startTime: time(breakStart),
      endTime: time(breakEnd),
      durationMinutes: meal.durationMinutes,
      reason:
        'A generic meal window is reserved because no selected food stop satisfies it.',
    });
    nextCurrent = breakEnd;
  }
  return nextCurrent;
}

/**
 * A route-independent draft schedule. It uses Haversine-derived buffers only;
 * Phase 9F will validate these estimates against actual route times.
 */
export function createDeterministicDraftSchedule(
  grouping: GeographicDayClustering,
  knownPlaces: CandidatePlace[],
  recommendedStayArea: string | null,
  constraints?: DeterministicScheduleConstraints,
  routeDurations?: RouteDurationOverrides,
): DeterministicDraftSchedule {
  const paceProfile = derivePaceProfile(constraints?.averagePace);
  const stayOrigin =
    constraints?.stayAnchor ??
    centroidForArea(recommendedStayArea, knownPlaces);
  let scheduledPlaceCount = 0;
  let overflowPlaceCount = 0;
  const days = grouping.days.map((group) => {
    const breaks: DraftScheduleBreak[] = [];
    const items: DraftScheduleItem[] = [];
    const overflow: DraftScheduleOverflow[] = [];
    const isFirstDay = group.day === 1;
    const isFinalDay = group.day === grouping.activeDays;
    const dayOfWeek = tripDayOfWeek(constraints?.startDate, group.day);
    const arrivalMinutes = isFirstDay
      ? parseTimeMinutes(constraints?.arrivalTime)
      : null;
    const departureMinutes = isFinalDay
      ? parseTimeMinutes(constraints?.departureTime)
      : null;
    const arrivalOrigin =
      isFirstDay && constraints?.arrivalPoint
        ? {
            latitude: constraints.arrivalPoint.latitude,
            longitude: constraints.arrivalPoint.longitude,
          }
        : null;
    const departureTarget =
      isFinalDay && constraints?.departurePoint
        ? {
            latitude: constraints.departurePoint.latitude,
            longitude: constraints.departurePoint.longitude,
          }
        : null;
    const origin = arrivalOrigin ?? stayOrigin ?? fallbackOrigin(group.places);
    const returnTarget = isFinalDay
      ? (departureTarget ?? stayOrigin)
      : stayOrigin;
    const ordered = orderedPlaces(
      group.places,
      origin,
      returnTarget,
      dayOfWeek,
    );
    const dayEnd = Math.min(
      paceProfile.targetReturnMinutes,
      departureMinutes ?? paceProfile.targetReturnMinutes,
    );
    const dayStart = Math.max(
      paceProfile.earliestActivityMinutes,
      arrivalMinutes ?? paceProfile.earliestActivityMinutes,
    );
    let current = dayStart;
    let previous: DayClusterSelection | null = null;
    const dayRouteDurations = routeDurations?.[group.day];
    for (const [placeIndex, place] of ordered.entries()) {
      const duration = durationFor(place);
      const timing = classifyPlaceTiming(place);
      const priorCoordinate =
        previous && hasCoordinates(previous) ? previous : origin;
      const targetCoordinate = hasCoordinates(place) ? place : null;
      const overriddenTransition =
        dayRouteDurations?.[
          routeDurationKey(previous?.id ?? ROUTE_START_ANCHOR_ID, place.id)
        ];
      const transition =
        overriddenTransition ??
        (!previous && arrivalMinutes !== null && !arrivalOrigin && !stayOrigin
          ? 0
          : approximateTransitionMinutes(
              priorCoordinate,
              targetCoordinate,
              paceProfile,
            ));
      const overriddenReturnTransition =
        dayRouteDurations?.[routeDurationKey(place.id, ROUTE_END_ANCHOR_ID)];
      const returnTransition = returnTarget
        ? (overriddenReturnTransition ??
          approximateTransitionMinutes(
            targetCoordinate,
            returnTarget,
            paceProfile,
          ))
        : 0;
      const latestActivityEnd = dayEnd - returnTransition;
      const placeTier = selectionPriorityTier(place);
      const higherPriorityRemaining = ordered
        .slice(placeIndex + 1)
        .filter((candidate) => selectionPriorityTier(candidate) < placeTier);
      const reservedConsensusMinutes = higherPriorityRemaining.reduce(
        (sum, candidate) => sum + durationFor(candidate).minutes + 10,
        0,
      );
      const consensusCapacityReserved =
        reservedConsensusMinutes > 0 &&
        current + transition + duration.minutes + reservedConsensusMinutes >
          latestActivityEnd;
      let slot = consensusCapacityReserved
        ? null
        : feasibleSlotAroundBreaks(
            place,
            timing,
            current + transition,
            duration.minutes,
            latestActivityEnd,
            dayOfWeek,
            paceProfile,
            breaks,
          );
      const afterBreak = addBreakIfNeeded(
        breaks,
        current,
        slot?.startMinutes ?? current + transition,
        duration.minutes,
        timing,
        paceProfile,
      );
      if (afterBreak !== current) {
        slot = feasibleSlotAroundBreaks(
          place,
          timing,
          afterBreak + transition,
          duration.minutes,
          latestActivityEnd,
          dayOfWeek,
          paceProfile,
          breaks,
        );
      }
      if (!slot) {
        const openingHoursKnown =
          place.openingPeriods !== null &&
          place.openingPeriods !== undefined &&
          dayOfWeek !== null;
        const reason = consensusCapacityReserved
          ? isRecommendationPriority(place)
            ? 'Moved to Optional to preserve daily capacity for stronger deterministic recommendations.'
            : 'Moved to overflow to preserve daily capacity for remaining unanimous or majority group priorities.'
          : openingHoursKnown
            ? 'Could not fit this place within its known opening hours and the available daily window.'
            : departureMinutes !== null
              ? 'Could not fit before the saved departure boundary after higher-priority places, estimated buffers, and meal windows.'
              : returnTarget && !isFinalDay
                ? 'Kept the evening lighter so the group can return toward the stay area by the pace-based daily boundary.'
                : `Could not fit before the ${time(dayEnd)} pace-based daily boundary after higher-priority places, estimated buffers, and meal windows.`;
        overflow.push({
          placeId: place.id,
          name: place.name,
          durationMinutes: duration.minutes,
          reason,
        });
        overflowPlaceCount += 1;
        continue;
      }
      const start = slot.startMinutes;
      const reasons = [
        `Uses ${duration.source} (${duration.minutes} min).`,
        overriddenTransition === undefined
          ? `Includes an approximate ${transition}-minute Haversine transition buffer; route validation comes next.`
          : `Uses an ORS-validated ${transition}-minute road transition buffer.`,
      ];
      if (!previous && arrivalMinutes !== null) {
        reasons.push(
          `Starts after the group's saved ${constraints?.arrivalTime} arrival boundary${arrivalOrigin ? ' and an approximate endpoint transition' : ''}.`,
        );
      }
      if (departureMinutes !== null) {
        reasons.push(
          `Leaves enough deterministic capacity before the group's saved ${constraints?.departureTime} departure boundary${departureTarget ? ' and an approximate endpoint transition' : ''}.`,
        );
      }
      if (returnTarget && !isFinalDay) {
        reasons.push(
          `Reserves approximate travel time to return toward the recommended stay area by ${time(dayEnd)}.`,
        );
      }
      if (items.length === 0 && paceProfile.level <= 2) {
        reasons.push('Later start for your relaxed travel pace.');
      } else if (items.length === 0 && paceProfile.level >= 4) {
        reasons.push(
          'Denser safe travel buffers support your group’s active travel pace.',
        );
      }
      if (slot.daypart === 'evening') {
        reasons.push('Best visited in the evening.');
      } else if (
        slot.daypart === 'lunch' &&
        timing.mealTypes.includes('lunch')
      ) {
        reasons.push('Scheduled for lunch time.');
      } else if (
        slot.daypart === 'dinner' &&
        timing.mealTypes.includes('dinner')
      ) {
        reasons.push('Scheduled for dinner time.');
      } else if (slot.preferredDaypart) {
        reasons.push(`Scheduled in its preferred ${slot.daypart} period.`);
      }
      if (
        slot.openingHoursKnown &&
        slot.closesAtMinutes !== null &&
        slot.closesAtMinutes <= 17 * 60
      ) {
        reasons.push('Placed earlier because it closes in the afternoon.');
      } else if (slot.shiftedToOpening) {
        reasons.push('Scheduled after its known opening time.');
      }
      if (isRecommendationPriority(place)) {
        reasons.push(
          'Automatically selected from the group’s deterministic Travel DNA ranking.',
        );
      } else if (
        place.totalMembers > 0 &&
        place.voteCount >= place.totalMembers
      ) {
        reasons.push(
          'Included first because it is a shared priority for everyone in the group.',
        );
      } else if (
        place.totalMembers > 0 &&
        place.voteCount * 2 > place.totalMembers
      ) {
        reasons.push(
          'Included early because a majority of the group chose it.',
        );
      } else {
        reasons.push(
          'Included as an individual group member preference after broader shared priorities.',
        );
      }
      if (previous)
        reasons.push(
          `Placed after ${previous.name} using geographic proximity and group priority.`,
        );
      else if (constraints?.stayAnchor)
        reasons.push(
          `Day starts from the exact stay at ${constraints.stayAnchor.name}.`,
        );
      else if (recommendedStayArea && stayOrigin)
        reasons.push(
          `Day starts from the representative coordinate for the recommended ${recommendedStayArea} stay area.`,
        );
      else
        reasons.push(
          'Day starts from a deterministic geographic fallback because no stay-area coordinate is available.',
        );
      items.push({
        placeId: place.id,
        name: place.name,
        startTime: time(start),
        endTime: time(start + duration.minutes),
        durationMinutes: duration.minutes,
        estimatedTransitionMinutesBefore: transition,
        schedulingReasons: reasons,
      });
      const itemEnd = start + duration.minutes;
      if (
        timing.mealTypes.includes('lunch') &&
        overlapsWindow(start, duration.minutes, paceProfile.lunch) &&
        !breaks.some((item) => item.label === 'Lunch / break')
      ) {
        breaks.push({
          label: 'Lunch / break',
          startTime: time(start),
          endTime: time(itemEnd),
          durationMinutes: duration.minutes,
          reason: `${place.name} is suitable for lunch and satisfies the planning window.`,
        });
      }
      if (
        timing.mealTypes.includes('dinner') &&
        overlapsWindow(start, duration.minutes, paceProfile.dinner) &&
        !breaks.some((item) => item.label === 'Dinner / break')
      ) {
        breaks.push({
          label: 'Dinner / break',
          startTime: time(start),
          endTime: time(itemEnd),
          durationMinutes: duration.minutes,
          reason: `${place.name} is suitable for dinner and satisfies the planning window.`,
        });
      }
      current = start + duration.minutes;
      previous = place;
      scheduledPlaceCount += 1;
    }
    return {
      day: group.day,
      startTime: time(dayStart),
      endTime: time(dayEnd),
      items,
      breaks: breaks.sort(
        (a, b) =>
          a.startTime.localeCompare(b.startTime) ||
          a.label.localeCompare(b.label),
      ),
      overflow,
    };
  });
  return {
    status: grouping.status,
    days,
    scheduledPlaceCount,
    overflowPlaceCount,
    unlocatedPlaceCount: grouping.unlocatedPlaceCount,
  };
}
