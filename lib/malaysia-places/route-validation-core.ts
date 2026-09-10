import type { RoutingPoint } from '@/lib/routing/route-points-core';
import type { TripRoute } from '@/lib/routing/types';
import {
  isRecommendationPriority,
  selectionPriorityTier,
} from './selection-priority-core';
import type {
  DayClusterSelection,
  GeographicDayClustering,
} from './day-clustering-core';
import {
  ROUTE_END_ANCHOR_ID,
  ROUTE_START_ANCHOR_ID,
  centroidForArea,
  createDeterministicDraftSchedule,
  routeDurationKey,
  type DeterministicDraftSchedule,
  type DeterministicScheduleConstraints,
  type DraftScheduleItem,
  type DraftScheduleOverflow,
  type RouteDurationOverrides,
} from './deterministic-scheduling-core';
import { derivePaceProfile, type PaceProfile } from './pace-profile-core';
import type { CandidatePlace } from './types';

const MAX_ROUTE_ATTEMPTS_PER_DAY = 3;

type Coordinate = { latitude: number; longitude: number };

export type RouteValidationDayStatus = {
  day: number;
  status: 'validated' | 'haversine_fallback' | 'not_required';
  attempts: number;
  reason: string | null;
  routeDurationMinutes?: number | null;
  returnTransitionMinutes?: number | null;
};

export type RouteValidationStatus = {
  status: 'validated' | 'partial_fallback' | 'haversine_fallback';
  orsCalls: number;
  repaired: boolean;
  days: RouteValidationDayStatus[];
};

export type RouteValidatedSchedule = DeterministicDraftSchedule & {
  routeValidation: RouteValidationStatus;
};

export type RouteProvider = (points: RoutingPoint[]) => Promise<TripRoute>;

function hasCoordinates(
  place: Pick<CandidatePlace, 'latitude' | 'longitude'>,
): place is Pick<CandidatePlace, 'latitude' | 'longitude'> & Coordinate {
  return place.latitude !== null && place.longitude !== null;
}

function planningAnchors(
  day: number,
  activeDays: number,
  stay: Coordinate | null,
  constraints?: DeterministicScheduleConstraints,
) {
  const first = day === 1;
  const final = day === activeDays;
  const arrival = first ? (constraints?.arrivalPoint ?? null) : null;
  const departure = final ? (constraints?.departurePoint ?? null) : null;
  return {
    start: arrival ?? stay,
    end: departure ?? stay,
  };
}

function routingPointsForDay(
  schedule: DeterministicDraftSchedule,
  day: number,
  candidatesById: Map<string, CandidatePlace>,
  stay: Coordinate | null,
  constraints?: DeterministicScheduleConstraints,
): RoutingPoint[] | null {
  const scheduledDay = schedule.days.find((candidate) => candidate.day === day);
  if (!scheduledDay) return [];
  if (scheduledDay.items.length === 0) return [];
  const anchors = planningAnchors(day, schedule.days.length, stay, constraints);
  const points: RoutingPoint[] = [];
  if (anchors.start) {
    points.push({
      id: ROUTE_START_ANCHOR_ID,
      latitude: anchors.start.latitude,
      longitude: anchors.start.longitude,
    });
  }
  for (const item of scheduledDay.items) {
    const candidate = candidatesById.get(item.placeId);
    if (!candidate || !hasCoordinates(candidate)) return null;
    points.push({
      id: item.placeId,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    });
  }
  if (anchors.end) {
    points.push({
      id: ROUTE_END_ANCHOR_ID,
      latitude: anchors.end.latitude,
      longitude: anchors.end.longitude,
    });
  }
  return points;
}

function bufferedRouteMinutes(durationSeconds: number, profile: PaceProfile) {
  return Math.max(
    1,
    Math.ceil(
      ((durationSeconds / 60) * profile.transitionBufferMultiplier) / 5,
    ) * 5,
  );
}

function routeOverrides(
  points: RoutingPoint[],
  route: TripRoute,
  profile: PaceProfile,
) {
  if (route.segments.length !== points.length - 1) {
    throw new Error('ORS route did not include every planned leg.');
  }
  const result: Record<string, number> = {};
  route.segments.forEach((segment, index) => {
    const from = points[index];
    const to = points[index + 1];
    if (
      !from ||
      !to ||
      segment.fromItemId !== from.id ||
      segment.toItemId !== to.id
    ) {
      throw new Error('ORS route legs did not match the planned order.');
    }
    result[routeDurationKey(from.id, to.id)] = bufferedRouteMinutes(
      segment.durationSeconds,
      profile,
    );
  });
  return result;
}

function filteredGrouping(
  grouping: GeographicDayClustering,
  excluded: Set<string>,
  included: Set<string>,
): GeographicDayClustering {
  return {
    ...grouping,
    days: grouping.days.map((day) => {
      const places = day.places.filter(
        (place) => included.has(place.id) && !excluded.has(place.id),
      );
      return {
        ...day,
        places,
        placeCount: places.length,
        missingCoordinatePlaceCount: places.filter(
          (place) => !hasCoordinates(place),
        ).length,
      };
    }),
  };
}

function sameRoute(
  before: DeterministicDraftSchedule,
  after: DeterministicDraftSchedule,
  day: number,
) {
  const beforeIds =
    before.days
      .find((candidate) => candidate.day === day)
      ?.items.map((item) => item.placeId) ?? [];
  const afterIds =
    after.days
      .find((candidate) => candidate.day === day)
      ?.items.map((item) => item.placeId) ?? [];
  return (
    beforeIds.length === afterIds.length &&
    beforeIds.every((id, index) => id === afterIds[index])
  );
}

function removalCandidate(
  places: DayClusterSelection[],
  route: TripRoute,
  scheduledItems: DraftScheduleItem[],
) {
  const placesById = new Map(places.map((place) => [place.id, place]));
  const scheduledById = new Map(
    scheduledItems.map((item) => [item.placeId, item]),
  );
  const routeIds = route.segments.length
    ? [
        route.segments[0].fromItemId,
        ...route.segments.map((segment) => segment.toItemId),
      ]
    : [];
  const contribution = new Map<string, number>();
  for (const segment of route.segments) {
    if (
      segment.fromItemId !== ROUTE_START_ANCHOR_ID &&
      segment.fromItemId !== ROUTE_END_ANCHOR_ID
    ) {
      contribution.set(
        segment.fromItemId,
        (contribution.get(segment.fromItemId) ?? 0) + segment.durationSeconds,
      );
    }
    if (
      segment.toItemId !== ROUTE_START_ANCHOR_ID &&
      segment.toItemId !== ROUTE_END_ANCHOR_ID
    ) {
      contribution.set(
        segment.toItemId,
        (contribution.get(segment.toItemId) ?? 0) + segment.durationSeconds,
      );
    }
  }
  for (const place of places) {
    const index = routeIds.indexOf(place.id);
    const adjacentIds = [routeIds[index - 1], routeIds[index + 1]];
    const areaJumps = adjacentIds.filter((id) => {
      const adjacent = placesById.get(id);
      return adjacent?.area && place.area && adjacent.area !== place.area;
    }).length;
    const scheduled = scheduledById.get(place.id);
    const poorDaypartFit = scheduled
      ? !scheduled.schedulingReasons.some(
          (reason) =>
            reason.includes('preferred') ||
            reason.includes('Best visited') ||
            reason.includes('lunch time') ||
            reason.includes('dinner time'),
        )
      : false;
    contribution.set(
      place.id,
      (contribution.get(place.id) ?? 0) +
        areaJumps * 20 * 60 +
        (poorDaypartFit ? 15 * 60 : 0),
    );
  }
  return (
    [...places].sort((a, b) => {
      const aTier = selectionPriorityTier(a);
      const bTier = selectionPriorityTier(b);
      return (
        bTier - aTier ||
        (contribution.get(b.id) ?? 0) - (contribution.get(a.id) ?? 0) ||
        a.groupScore - b.groupScore ||
        a.score - b.score ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    })[0] ?? null
  );
}

function addForcedOverflow(
  schedule: DeterministicDraftSchedule,
  original: Map<number, DraftScheduleOverflow[]>,
  removed: Map<number, DraftScheduleOverflow[]>,
) {
  const days = schedule.days.map((day) => ({
    ...day,
    overflow: Array.from(
      new Map(
        [
          ...day.overflow,
          ...(original.get(day.day) ?? []),
          ...(removed.get(day.day) ?? []),
        ].map((item) => [item.placeId, item]),
      ).values(),
    ),
  }));
  const overflowPlaceCount = days.reduce(
    (sum, day) => sum + day.overflow.length,
    0,
  );
  return { ...schedule, days, overflowPlaceCount };
}

export async function validateDeterministicScheduleRoutes({
  grouping,
  knownPlaces,
  recommendedStayArea,
  constraints,
  schedule,
  routeProvider,
}: {
  grouping: GeographicDayClustering;
  knownPlaces: CandidatePlace[];
  recommendedStayArea: string | null;
  constraints?: DeterministicScheduleConstraints;
  schedule: DeterministicDraftSchedule;
  routeProvider: RouteProvider;
}): Promise<RouteValidatedSchedule> {
  const candidatesById = new Map(
    knownPlaces.map((candidate) => [candidate.id, candidate]),
  );
  const stay =
    constraints?.stayAnchor ??
    centroidForArea(recommendedStayArea, knownPlaces);
  const profile = derivePaceProfile(constraints?.averagePace);
  const excluded = new Set<string>();
  const included = new Set(
    schedule.days.flatMap((day) => day.items.map((item) => item.placeId)),
  );
  const originalOverflow = new Map(
    schedule.days.map((day) => [day.day, day.overflow]),
  );
  const removed = new Map<number, DraftScheduleOverflow[]>();
  const durationOverrides: RouteDurationOverrides = {};
  const dayStatuses: RouteValidationDayStatus[] = [];
  let workingSchedule = schedule;
  let orsCalls = 0;

  for (const group of grouping.days) {
    let finalStatus: RouteValidationDayStatus | null = null;
    for (let attempt = 1; attempt <= MAX_ROUTE_ATTEMPTS_PER_DAY; attempt += 1) {
      const points = routingPointsForDay(
        workingSchedule,
        group.day,
        candidatesById,
        stay,
        constraints,
      );
      if (points === null) {
        delete durationOverrides[group.day];
        finalStatus = {
          day: group.day,
          status: 'haversine_fallback',
          attempts: attempt - 1,
          reason: 'A scheduled place is missing valid routing coordinates.',
        };
        break;
      }
      if (points.length < 2) {
        finalStatus = {
          day: group.day,
          status: 'not_required',
          attempts: attempt - 1,
          reason: null,
        };
        break;
      }

      let route: TripRoute;
      try {
        orsCalls += 1;
        route = await routeProvider(points);
        durationOverrides[group.day] = routeOverrides(points, route, profile);
      } catch {
        delete durationOverrides[group.day];
        workingSchedule = createDeterministicDraftSchedule(
          filteredGrouping(grouping, excluded, included),
          knownPlaces,
          recommendedStayArea,
          constraints,
          durationOverrides,
        );
        finalStatus = {
          day: group.day,
          status: 'haversine_fallback',
          attempts: attempt,
          reason: 'ORS was unavailable or returned an invalid route.',
        };
        break;
      }

      const routedSchedule = createDeterministicDraftSchedule(
        filteredGrouping(grouping, excluded, included),
        knownPlaces,
        recommendedStayArea,
        constraints,
        durationOverrides,
      );
      if (sameRoute(workingSchedule, routedSchedule, group.day)) {
        workingSchedule = routedSchedule;
        const scheduledItems = routedSchedule.days.find(
          (candidate) => candidate.day === group.day,
        )?.items;
        const finalPlaceId = scheduledItems?.at(-1)?.placeId;
        const dayDurations = durationOverrides[group.day];
        finalStatus = {
          day: group.day,
          status: 'validated',
          attempts: attempt,
          reason: null,
          routeDurationMinutes: Object.values(dayDurations ?? {}).reduce(
            (sum, duration) => sum + duration,
            0,
          ),
          returnTransitionMinutes: finalPlaceId
            ? (dayDurations?.[
                routeDurationKey(finalPlaceId, ROUTE_END_ANCHOR_ID)
              ] ?? null)
            : null,
        };
        break;
      }

      const scheduledIds = new Set(
        workingSchedule.days
          .find((candidate) => candidate.day === group.day)
          ?.items.map((item) => item.placeId) ?? [],
      );
      const removable = removalCandidate(
        group.places.filter(
          (place) => scheduledIds.has(place.id) && !excluded.has(place.id),
        ),
        route,
        workingSchedule.days.find((candidate) => candidate.day === group.day)
          ?.items ?? [],
      );
      if (!removable) {
        delete durationOverrides[group.day];
        finalStatus = {
          day: group.day,
          status: 'haversine_fallback',
          attempts: attempt,
          reason: 'No deterministic overflow candidate remained.',
        };
        break;
      }
      excluded.add(removable.id);
      const removedItem = workingSchedule.days
        .find((candidate) => candidate.day === group.day)
        ?.items.find((item) => item.placeId === removable.id);
      const overflow = removed.get(group.day) ?? [];
      overflow.push({
        placeId: removable.id,
        name: removable.name,
        durationMinutes:
          removedItem?.durationMinutes ??
          removable.estimatedDurationMinutes ??
          90,
        reason: isRecommendationPriority(removable)
          ? 'Moved to Optional after ORS road durations exceeded the feasible daily route; lower recommendation rank and route detour were considered.'
          : 'Moved to overflow after ORS road durations exceeded the feasible daily route; lower consensus priority and route detour were considered.',
      });
      removed.set(group.day, overflow);
      delete durationOverrides[group.day];
      workingSchedule = createDeterministicDraftSchedule(
        filteredGrouping(grouping, excluded, included),
        knownPlaces,
        recommendedStayArea,
        constraints,
        durationOverrides,
      );
      if (attempt === MAX_ROUTE_ATTEMPTS_PER_DAY) {
        finalStatus = {
          day: group.day,
          status: 'haversine_fallback',
          attempts: attempt,
          reason: 'Bounded ORS revalidation attempts were exhausted.',
        };
      }
    }
    dayStatuses.push(
      finalStatus ?? {
        day: group.day,
        status: 'haversine_fallback',
        attempts: MAX_ROUTE_ATTEMPTS_PER_DAY,
        reason: 'Bounded ORS revalidation attempts were exhausted.',
      },
    );
  }

  const finalSchedule = addForcedOverflow(
    workingSchedule,
    originalOverflow,
    removed,
  );
  const validatedDays = dayStatuses.filter(
    (day) => day.status === 'validated' || day.status === 'not_required',
  ).length;
  const fallbackDays = dayStatuses.length - validatedDays;
  return {
    ...finalSchedule,
    routeValidation: {
      status:
        fallbackDays === 0
          ? 'validated'
          : validatedDays > 0
            ? 'partial_fallback'
            : 'haversine_fallback',
      orsCalls,
      repaired: removed.size > 0,
      days: dayStatuses,
    },
  };
}
