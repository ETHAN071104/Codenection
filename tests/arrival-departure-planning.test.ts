import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicDraftSchedule } from '../lib/malaysia-places/deterministic-scheduling-core';
import type {
  DayClusterSelection,
  GeographicDayClustering,
} from '../lib/malaysia-places/day-clustering-core';
import {
  ARRIVAL_ENDPOINT_ID,
  DEPARTURE_ENDPOINT_ID,
  buildRoutingPoints,
} from '../lib/routing/route-points-core';
import { applyTimeBoundariesToGeneratedItinerary } from '../lib/phase2/time-boundaries-core';
import type { ItineraryItemView } from '../lib/phase2/types';

function place(id: string, voteCount: number, durationMinutes = 120): DayClusterSelection {
  return {
    id,
    googlePlaceId: `google-${id}`,
    name: `Place ${id}`,
    country: 'Malaysia',
    state: 'Johor',
    city: 'Johor Bahru',
    area: 'Central',
    latitude: 1.47,
    longitude: 103.76,
    category: 'tourist_attraction',
    subcategories: [],
    estimatedDurationMinutes: durationMinutes,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: 'any',
    cultureScore: 70,
    foodScore: 50,
    natureScore: 20,
    shoppingScore: 30,
    adventureScore: 20,
    nightlifeScore: 20,
    photographyScore: 60,
    budgetScore: 60,
    googleRating: 4.5,
    googleRatingCount: 100,
    priceLevel: null,
    source: 'google_places',
    lastVerifiedAt: null,
    score: 80,
    reasons: ['Strong group fit'],
    voteCount,
    totalMembers: 3,
    groupScore: 80,
  };
}

function grouping(places: DayClusterSelection[]): GeographicDayClustering {
  return {
    status: 'ready',
    activeDays: 1,
    unlocatedPlaceCount: 0,
    days: [{
      day: 1,
      places,
      centroid: { latitude: 1.47, longitude: 103.76 },
      placeCount: places.length,
      geographicSpreadKm: 0,
      missingCoordinatePlaceCount: 0,
    }],
  };
}

const airport = {
  googlePlaceId: 'airport-id',
  name: 'Grounded Airport',
  address: 'Johor, Malaysia',
  latitude: 1.64,
  longitude: 103.67,
};

void test('Day 1 starts at or after the arrival boundary', () => {
  const input = grouping([place('shared', 3)]);
  const schedule = createDeterministicDraftSchedule(input, input.days[0].places, null, {
    arrivalTime: '14:00',
    departureTime: null,
    arrivalPoint: null,
    departurePoint: null,
  });
  assert.equal(schedule.days[0].startTime, '14:00');
  assert.equal(schedule.days[0].items[0].startTime, '14:00');
});

void test('final-day capacity protects consensus and overflows lower priority', () => {
  const input = grouping([
    place('single', 1, 150),
    place('unanimous', 3, 150),
    place('majority', 2, 150),
  ]);
  const first = createDeterministicDraftSchedule(input, input.days[0].places, null, {
    arrivalTime: '09:00',
    departureTime: '14:00',
    arrivalPoint: null,
    departurePoint: airport,
  });
  const second = createDeterministicDraftSchedule(input, input.days[0].places, null, {
    arrivalTime: '09:00',
    departureTime: '14:00',
    arrivalPoint: null,
    departurePoint: airport,
  });
  assert.deepEqual(second, first);
  assert.deepEqual(first.days[0].items.map((item) => item.placeId), [
    'unanimous',
  ]);
  assert.deepEqual(first.days[0].overflow.map((item) => item.placeId), [
    'majority',
    'single',
  ]);
  assert.ok(first.days[0].items.every((item) => item.endTime <= '14:00'));
});

void test('grounded endpoints map around attractions without becoming itinerary items', () => {
  const item = {
    id: 'stop-1',
    place: { longitude: 103.76, latitude: 1.47 },
  } as ItineraryItemView;
  assert.deepEqual(
    buildRoutingPoints([item], { start: airport, end: airport }).map((point) => point.id),
    [ARRIVAL_ENDPOINT_ID, 'stop-1', DEPARTURE_ENDPOINT_ID],
  );
});

void test('AI schedule respects arrival and departure times deterministically', () => {
  const itinerary = {
    days: [{
      day: 1,
      theme: 'A short day',
      items: [{
        externalPlaceId: 'one',
        estimatedDurationMinutes: 90,
        estimatedCost: null,
        reason: 'Grounded group fit',
      }],
    }],
  };
  const first = applyTimeBoundariesToGeneratedItinerary(itinerary, {
    arrivalTime: '14:00',
    departureTime: '17:00',
  });
  assert.deepEqual(
    applyTimeBoundariesToGeneratedItinerary(itinerary, {
      arrivalTime: '14:00',
      departureTime: '17:00',
    }),
    first,
  );
  assert.equal(first?.[0]?.plannedTime, '14:00');
  assert.equal(
    applyTimeBoundariesToGeneratedItinerary(itinerary, {
      arrivalTime: '16:00',
      departureTime: '17:00',
    }),
    null,
  );
});
