import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoutingPoint } from '../lib/routing/route-points-core';
import type { TripRoute } from '../lib/routing/types';
import type {
  DayClusterSelection,
  GeographicDayClustering,
} from '../lib/malaysia-places/day-clustering-core';
import {
  ROUTE_END_ANCHOR_ID,
  ROUTE_START_ANCHOR_ID,
  createDeterministicDraftSchedule,
  orderedPlaces,
} from '../lib/malaysia-places/deterministic-scheduling-core';
import { validateDeterministicScheduleRoutes } from '../lib/malaysia-places/route-validation-core';

function place(
  id: string,
  area: string,
  latitude: number,
  longitude: number,
  voteCount = 3,
  durationMinutes = 60,
): DayClusterSelection {
  return {
    id,
    googlePlaceId: `google-${id}`,
    name: `Place ${id}`,
    country: 'Malaysia',
    state: 'Kuala Lumpur',
    city: 'Kuala Lumpur',
    area,
    latitude,
    longitude,
    category: 'tourist_attraction',
    subcategories: [],
    estimatedDurationMinutes: durationMinutes,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: 'any',
    openingPeriods: null,
    cultureScore: 70,
    foodScore: 40,
    natureScore: 30,
    shoppingScore: 30,
    adventureScore: 20,
    nightlifeScore: 10,
    photographyScore: 60,
    budgetScore: 60,
    googleRating: 4.5,
    googleRatingCount: 100,
    priceLevel: null,
    photoName: null,
    photoWidthPx: null,
    photoHeightPx: null,
    photoAttributions: [],
    source: 'google_places',
    lastVerifiedAt: null,
    score: 80,
    reasons: ['Fixture'],
    voteCount,
    totalMembers: 3,
    groupScore: 80,
  };
}

function grouping(days: DayClusterSelection[][]): GeographicDayClustering {
  return {
    status: 'ready',
    activeDays: days.length,
    unlocatedPlaceCount: 0,
    days: days.map((places, index) => ({
      day: index + 1,
      places,
      centroid: places[0]
        ? { latitude: places[0].latitude!, longitude: places[0].longitude! }
        : null,
      placeCount: places.length,
      geographicSpreadKm: 0,
      missingCoordinatePlaceCount: 0,
    })),
  };
}

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

const stay = place('stay-proxy', 'Stay', 3.14, 101.69);
const arrival = {
  googlePlaceId: 'arrival',
  name: 'Arrival airport',
  address: null,
  latitude: 3.3,
  longitude: 101.5,
};
const departure = {
  googlePlaceId: 'departure',
  name: 'Departure airport',
  address: null,
  latitude: 2.75,
  longitude: 101.7,
};

void test('avoids A to B to A area bouncing when a coherent order exists', () => {
  const a1 = place('a1', 'A', 3.14, 101.69);
  const b = place('b', 'B', 3.25, 101.8);
  const a2 = place('a2', 'A', 3.15, 101.7);
  const ordered = orderedPlaces(
    [a1, b, a2],
    { latitude: 3.14, longitude: 101.69 },
    { latitude: 3.14, longitude: 101.69 },
  );
  assert.notDeepEqual(
    ordered.map((item) => item.area),
    ['A', 'B', 'A'],
  );
  assert.equal(
    ordered.slice(1).filter((item, index) => item.area !== ordered[index].area)
      .length,
    1,
  );
});

void test('final-day ordering progresses toward the departure airport', () => {
  const north = place('north', 'North', 3.3, 101.69);
  const south = place('south', 'South', 2.9, 101.69);
  const ordered = orderedPlaces(
    [south, north],
    { latitude: stay.latitude!, longitude: stay.longitude! },
    { latitude: departure.latitude, longitude: departure.longitude },
  );
  assert.deepEqual(
    ordered.map((item) => item.id),
    ['north', 'south'],
  );
});

void test('normal day routes from Stay through activities and back to Stay', async () => {
  const activity = place('normal', 'Central', 3.16, 101.71);
  const input = grouping([[activity]]);
  const local = createDeterministicDraftSchedule(input, [activity, stay], 'Stay');
  let observed: string[] = [];
  await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [activity, stay],
    recommendedStayArea: 'Stay',
    schedule: local,
    routeProvider: async (points) => {
      observed = points.map((point) => point.id);
      return routeFor(points);
    },
  });
  assert.deepEqual(observed, [
    ROUTE_START_ANCHOR_ID,
    'normal',
    ROUTE_END_ANCHOR_ID,
  ]);
});

void test('arrival and final days use directional airport anchors', async () => {
  const first = place('first', 'Central', 3.2, 101.65);
  const final = place('final', 'South', 3.0, 101.7);
  const input = grouping([[first], [final]]);
  const constraints = {
    arrivalTime: '09:00',
    departureTime: '21:00',
    arrivalPoint: arrival,
    departurePoint: departure,
    averagePace: 3,
  };
  const local = createDeterministicDraftSchedule(
    input,
    [first, final, stay],
    'Stay',
    constraints,
  );
  const routes: RoutingPoint[][] = [];
  await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [first, final, stay],
    recommendedStayArea: 'Stay',
    constraints,
    schedule: local,
    routeProvider: async (points) => {
      routes.push(points);
      return routeFor(points);
    },
  });
  assert.deepEqual(
    routes[0].map((point) => [point.id, point.latitude, point.longitude]),
    [
      [ROUTE_START_ANCHOR_ID, arrival.latitude, arrival.longitude],
      ['first', first.latitude, first.longitude],
      [ROUTE_END_ANCHOR_ID, stay.latitude, stay.longitude],
    ],
  );
  assert.deepEqual(
    routes[1].map((point) => [point.id, point.latitude, point.longitude]),
    [
      [ROUTE_START_ANCHOR_ID, stay.latitude, stay.longitude],
      ['final', final.latitude, final.longitude],
      [ROUTE_END_ANCHOR_ID, departure.latitude, departure.longitude],
    ],
  );
});

void test('single-day trips route from arrival through activities to departure', async () => {
  const activity = place('single-day', 'Central', 3.1, 101.7);
  const input = grouping([[activity]]);
  const constraints = {
    arrivalTime: '09:00',
    departureTime: '21:00',
    arrivalPoint: arrival,
    departurePoint: departure,
    averagePace: 3,
  };
  const local = createDeterministicDraftSchedule(
    input,
    [activity, stay],
    'Stay',
    constraints,
  );
  let observed: RoutingPoint[] = [];
  await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [activity, stay],
    recommendedStayArea: 'Stay',
    constraints,
    schedule: local,
    routeProvider: async (points) => {
      observed = points;
      return routeFor(points);
    },
  });
  assert.deepEqual(
    observed.map((point) => [point.id, point.latitude, point.longitude]),
    [
      [ROUTE_START_ANCHOR_ID, arrival.latitude, arrival.longitude],
      ['single-day', activity.latitude, activity.longitude],
      [ROUTE_END_ANCHOR_ID, departure.latitude, departure.longitude],
    ],
  );
});

void test('ORS overflow protects unanimous places and removes a detour individual first', async () => {
  const unanimous = place('unanimous', 'Central', 3.15, 101.7, 3, 120);
  const individual = place('individual', 'Far', 3.5, 102.0, 1, 120);
  const input = grouping([[unanimous, individual]]);
  const constraints = {
    arrivalTime: null,
    departureTime: null,
    arrivalPoint: null,
    departurePoint: null,
    averagePace: 3,
  };
  const local = createDeterministicDraftSchedule(
    input,
    [unanimous, individual, stay],
    'Stay',
    constraints,
  );
  const validated = await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [unanimous, individual, stay],
    recommendedStayArea: 'Stay',
    constraints,
    schedule: local,
    routeProvider: async (points) =>
      routeFor(points, (from, to) =>
        from.id === 'individual' || to.id === 'individual' ? 6 * 60 * 60 : 600,
      ),
  });
  assert.deepEqual(validated.days[0].items.map((item) => item.placeId), [
    'unanimous',
  ]);
  assert.deepEqual(validated.days[0].overflow.map((item) => item.placeId), [
    'individual',
  ]);
  assert.equal(validated.routeValidation.status, 'validated');
  assert.equal(validated.routeValidation.orsCalls, 2);
});

void test('ORS failure preserves the Haversine itinerary with explicit fallback', async () => {
  const activity = place('fallback', 'Central', 3.16, 101.71);
  const input = grouping([[activity]]);
  const local = createDeterministicDraftSchedule(input, [activity, stay], 'Stay');
  const validated = await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [activity, stay],
    recommendedStayArea: 'Stay',
    schedule: local,
    routeProvider: async () => {
      throw new Error('offline');
    },
  });
  assert.deepEqual(validated.days[0].items, local.days[0].items);
  assert.equal(validated.routeValidation.status, 'haversine_fallback');
  assert.equal(
    validated.routeValidation.days[0].status,
    'haversine_fallback',
  );
});

void test('ORS reflow still respects PI-1 windows and PI-2 opening hours', async () => {
  const museum = {
    ...place('museum', 'Central', 3.16, 101.71, 3, 60),
    category: 'museum',
    openingPeriods: [
      { openDay: 2, openMinutes: 10 * 60, closeDay: 2, closeMinutes: 15 * 60 },
    ],
  };
  const input = grouping([[museum]]);
  const constraints = {
    arrivalTime: null,
    departureTime: '16:00',
    arrivalPoint: null,
    departurePoint: departure,
    averagePace: 1,
    startDate: '2026-09-08',
  };
  const local = createDeterministicDraftSchedule(
    input,
    [museum, stay],
    'Stay',
    constraints,
  );
  const validated = await validateDeterministicScheduleRoutes({
    grouping: input,
    knownPlaces: [museum, stay],
    recommendedStayArea: 'Stay',
    constraints,
    schedule: local,
    routeProvider: async (points) => routeFor(points, () => 10 * 60),
  });
  assert.equal(validated.days[0].startTime, '11:00');
  assert.ok(validated.days[0].items[0].startTime >= '11:00');
  assert.ok(validated.days[0].items[0].endTime <= '15:00');
  assert.ok(validated.days[0].items[0].endTime <= validated.days[0].endTime);
});
