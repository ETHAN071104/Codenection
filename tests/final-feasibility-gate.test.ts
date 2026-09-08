import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoutingPoint } from '../lib/routing/route-points-core';
import type { TripRoute } from '../lib/routing/types';
import type {
  DayClusterSelection,
  GeographicDayClustering,
} from '../lib/malaysia-places/day-clustering-core';
import { createDeterministicDraftSchedule } from '../lib/malaysia-places/deterministic-scheduling-core';
import {
  persistIfFinalFeasible,
  validateFinalCollaborativeItinerary,
} from '../lib/malaysia-places/final-feasibility-core';
import { validateDeterministicScheduleRoutes } from '../lib/malaysia-places/route-validation-core';

function place(
  id: string,
  votes = 3,
  durationMinutes = 60,
): DayClusterSelection {
  return {
    id,
    googlePlaceId: `google-${id}`,
    name: `Place ${id}`,
    country: 'Malaysia',
    state: 'Kuala Lumpur',
    city: 'Kuala Lumpur',
    area: id === 'stay' ? 'Stay' : 'Central',
    latitude: id === 'stay' ? 3.14 : 3.16,
    longitude: id === 'stay' ? 101.69 : 101.71,
    category: 'tourist_attraction',
    subcategories: [],
    estimatedDurationMinutes: durationMinutes,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: 'any',
    openingPeriods: null,
    cultureScore: 3,
    foodScore: 3,
    natureScore: 3,
    shoppingScore: 3,
    adventureScore: 3,
    nightlifeScore: 3,
    photographyScore: 3,
    budgetScore: null,
    googleRating: 4.5,
    googleRatingCount: 500,
    priceLevel: null,
    photoName: null,
    photoWidthPx: null,
    photoHeightPx: null,
    photoAttributions: [],
    source: 'google_places',
    lastVerifiedAt: null,
    score: 80,
    reasons: ['Fixture'],
    voteCount: votes,
    totalMembers: 3,
    groupScore: 80,
  };
}

function grouping(places: DayClusterSelection[]): GeographicDayClustering {
  return {
    status: 'ready',
    activeDays: 1,
    unlocatedPlaceCount: 0,
    days: [
      {
        day: 1,
        places,
        centroid: places[0]
          ? {
              latitude: places[0].latitude!,
              longitude: places[0].longitude!,
            }
          : null,
        placeCount: places.length,
        geographicSpreadKm: 0,
        missingCoordinatePlaceCount: 0,
      },
    ],
  };
}

const stay = place('stay');
const baseConstraints = {
  arrivalTime: null,
  departureTime: null,
  arrivalPoint: null,
  departurePoint: null,
  averagePace: 3,
  startDate: '2026-09-08',
};
const airport = {
  googlePlaceId: 'airport',
  name: 'Departure airport',
  address: null,
  latitude: 2.75,
  longitude: 101.7,
};

function routeFor(
  points: RoutingPoint[],
  duration: (from: RoutingPoint, to: RoutingPoint) => number = () => 300,
): TripRoute {
  return {
    geometry: null,
    totalDistanceMeters: 0,
    totalDurationSeconds: points
      .slice(1)
      .reduce((sum, to, index) => sum + duration(points[index], to), 0),
    segments: points.slice(1).map((to, index) => ({
      fromItemId: points[index].id,
      toItemId: to.id,
      distanceMeters: 1000,
      durationSeconds: duration(points[index], to),
    })),
  };
}

function validPlan(activity = place('activity')) {
  const input = grouping([activity]);
  const schedule = createDeterministicDraftSchedule(
    input,
    [activity, stay],
    'Stay',
    baseConstraints,
  );
  return { input, activity, schedule };
}

void test('known closed place cannot pass the persistence gate', () => {
  const { activity, schedule } = validPlan();
  const closed = { ...activity, openingPeriods: [] };
  const result = validateFinalCollaborativeItinerary({
    schedule,
    selected: [closed],
    candidates: [closed, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(
    result.issues.some((issue) => issue.code === 'OPENING_HOURS_CONFLICT'),
  );
});

void test('activity outside the arrival boundary fails', () => {
  const { activity, schedule } = validPlan();
  const result = validateFinalCollaborativeItinerary({
    schedule,
    selected: [activity],
    candidates: [activity, stay],
    recommendedStayArea: 'Stay',
    constraints: { ...baseConstraints, arrivalTime: '14:00' },
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some((issue) => issue.code === 'ARRIVAL_BOUNDARY'));
});

void test('airport capacity repairs a detour into overflow and preserves consensus', async () => {
  const unanimous = place('unanimous', 3, 120);
  const individual = {
    ...place('individual', 1, 120),
    area: 'Far',
    latitude: 3.5,
    longitude: 102,
  };
  const input = grouping([unanimous, individual]);
  const constraints = {
    ...baseConstraints,
    departureTime: '18:00',
    departurePoint: airport,
  };
  const local = createDeterministicDraftSchedule(
    input,
    [unanimous, individual, stay],
    'Stay',
    constraints,
  );
  const repaired = await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [unanimous, individual, stay],
    recommendedStayArea: 'Stay',
    constraints,
    schedule: local,
    routeProvider: async (points) =>
      routeFor(points, (from, to) =>
        from.id === 'individual' || to.id === 'individual'
          ? 4 * 60 * 60
          : 300,
      ),
  });
  const result = validateFinalCollaborativeItinerary({
    schedule: repaired,
    selected: [unanimous, individual],
    candidates: [unanimous, individual, stay],
    recommendedStayArea: 'Stay',
    constraints,
  });
  assert.equal(result.status, 'REPAIRED');
  assert.deepEqual(repaired.days[0].items.map((item) => item.placeId), [
    'unanimous',
  ]);
  assert.deepEqual(repaired.days[0].overflow.map((item) => item.placeId), [
    'individual',
  ]);
});

void test('return-to-Stay capacity is enforced through overflow', () => {
  const distant = {
    ...place('distant', 3, 680),
    latitude: 3.7,
    longitude: 102.2,
  };
  const input = grouping([distant]);
  const schedule = createDeterministicDraftSchedule(
    input,
    [distant, stay],
    'Stay',
    baseConstraints,
  );
  const result = validateFinalCollaborativeItinerary({
    schedule,
    selected: [distant],
    candidates: [distant, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
  });
  assert.deepEqual(schedule.days[0].items, []);
  assert.deepEqual(schedule.days[0].overflow.map((item) => item.placeId), [
    'distant',
  ]);
  assert.equal(result.status, 'REPAIRED');
});

void test('duplicate Google Place identity is rejected', () => {
  const first = place('first', 3, 45);
  const second = {
    ...place('second', 3, 45),
    googlePlaceId: first.googlePlaceId,
  };
  const input = grouping([first, second]);
  const schedule = createDeterministicDraftSchedule(
    input,
    [first, second, stay],
    'Stay',
    baseConstraints,
  );
  const result = validateFinalCollaborativeItinerary({
    schedule,
    selected: [first, second],
    candidates: [first, second, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_PLACE'));
});

void test('every selected place is accounted for as scheduled or Optional', () => {
  const scheduled = place('a-scheduled', 3, 60);
  const optional = place('z-optional', 3, 680);
  const input = grouping([scheduled, optional]);
  const schedule = createDeterministicDraftSchedule(
    input,
    [scheduled, optional, stay],
    'Stay',
    baseConstraints,
  );
  const result = validateFinalCollaborativeItinerary({
    schedule,
    selected: [scheduled, optional],
    candidates: [scheduled, optional, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
  });
  assert.equal(result.status, 'REPAIRED');
  assert.equal(result.selectedCount, result.scheduledCount + result.overflowCount);
  assert.ok(
    result.issues.every(
      (issue) => issue.code !== 'UNACCOUNTED_SELECTED_PLACE',
    ),
  );
});

void test('ORS fallback remains a valid explicit route state', async () => {
  const { input, activity, schedule } = validPlan();
  const fallback = await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [activity, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
    schedule,
    routeProvider: async () => {
      throw new Error('offline');
    },
  });
  const result = validateFinalCollaborativeItinerary({
    schedule: fallback,
    selected: [activity],
    candidates: [activity, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.routeStatus, 'haversine_fallback');
});

void test('repeated final validation is deterministic', () => {
  const { activity, schedule } = validPlan();
  const input = {
    schedule,
    selected: [activity],
    candidates: [activity, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
  };
  assert.deepEqual(
    validateFinalCollaborativeItinerary(input),
    validateFinalCollaborativeItinerary(input),
  );
});

void test('failed validation never invokes atomic persistence', async () => {
  const { activity, schedule } = validPlan();
  const closed = { ...activity, openingPeriods: [] };
  const validation = validateFinalCollaborativeItinerary({
    schedule,
    selected: [closed],
    candidates: [closed, stay],
    recommendedStayArea: 'Stay',
    constraints: baseConstraints,
  });
  let writes = 0;
  const persistence = await persistIfFinalFeasible(validation, async () => {
    writes += 1;
    return 'written';
  });
  assert.equal(persistence.persisted, false);
  assert.equal(writes, 0);
});
