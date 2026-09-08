import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicDraftSchedule } from '../lib/malaysia-places/deterministic-scheduling-core';
import { derivePaceProfile } from '../lib/malaysia-places/pace-profile-core';
import type {
  DayClusterSelection,
  GeographicDayClustering,
} from '../lib/malaysia-places/day-clustering-core';
import {
  ARRIVAL_ENDPOINT_ID,
  DEPARTURE_ENDPOINT_ID,
  buildRoutingPoints,
} from '../lib/routing/route-points-core';
import type { ItineraryItemView } from '../lib/phase2/types';

function place(
  id: string,
  voteCount: number,
  durationMinutes = 120,
): DayClusterSelection {
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
    openingPeriods: null,
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
    photoName: null,
    photoWidthPx: null,
    photoHeightPx: null,
    photoAttributions: [],
    source: 'google_places',
    lastVerifiedAt: null,
    score: 80,
    reasons: ['Strong group fit'],
    voteCount,
    totalMembers: 3,
    groupScore: 80,
  };
}

function grouping(
  places: DayClusterSelection[],
  activeDays = 1,
): GeographicDayClustering {
  return {
    status: 'ready',
    activeDays,
    unlocatedPlaceCount: 0,
    days: Array.from({ length: activeDays }, (_, index) => ({
      day: index + 1,
      places: index === 0 ? places : [],
      centroid: index === 0 ? { latitude: 1.47, longitude: 103.76 } : null,
      placeCount: index === 0 ? places.length : 0,
      geographicSpreadKm: index === 0 ? 0 : null,
      missingCoordinatePlaceCount: 0,
    })),
  };
}

const airport = {
  googlePlaceId: 'airport-id',
  name: 'Grounded Airport',
  address: 'Johor, Malaysia',
  latitude: 1.64,
  longitude: 103.67,
};

void test('Pace 1 starts later than Pace 5', () => {
  const input = grouping([place('shared', 3)]);
  const relaxed = createDeterministicDraftSchedule(
    input,
    input.days[0].places,
    null,
    {
      arrivalTime: null,
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
      averagePace: 1,
    },
  );
  const packed = createDeterministicDraftSchedule(
    input,
    input.days[0].places,
    null,
    {
      arrivalTime: null,
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
      averagePace: 5,
    },
  );
  assert.equal(relaxed.days[0].startTime, '11:00');
  assert.equal(packed.days[0].startTime, '09:00');
  assert.ok(
    relaxed.days[0].items[0].startTime > packed.days[0].items[0].startTime,
  );
});

void test('Pace 5 fits at least as much useful capacity as Pace 1', () => {
  const places = Array.from({ length: 8 }, (_, index) =>
    place(`capacity-${index}`, 3, 60),
  );
  const input = grouping(places);
  const scheduleFor = (averagePace: number) =>
    createDeterministicDraftSchedule(input, places, null, {
      arrivalTime: null,
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
      averagePace,
    });
  const relaxed = scheduleFor(1);
  const packed = scheduleFor(5);
  assert.ok(packed.scheduledPlaceCount >= relaxed.scheduledPlaceCount);
  assert.ok(packed.overflowPlaceCount <= relaxed.overflowPlaceCount);
});

void test('normal days reserve capacity to return toward the stay anchor', () => {
  const distant = {
    ...place('distant', 3, 680),
    area: 'Far',
    latitude: 1.7,
    longitude: 104.1,
  };
  const stayAnchor = {
    ...place('stay-anchor', 3),
    area: 'Stay',
    latitude: 1.47,
    longitude: 103.76,
  };
  const input = grouping([distant], 2);
  const schedule = createDeterministicDraftSchedule(
    input,
    [distant, stayAnchor],
    'Stay',
    {
      arrivalTime: null,
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
      averagePace: 5,
    },
  );
  assert.deepEqual(schedule.days[0].items, []);
  assert.deepEqual(
    schedule.days[0].overflow.map(({ placeId }) => placeId),
    ['distant'],
  );
  assert.match(
    schedule.days[0].overflow[0].reason,
    /return toward the stay area/,
  );
});

void test('arrival overrides the Pace 5 normal start', () => {
  const input = grouping([place('late-arrival', 3)]);
  const schedule = createDeterministicDraftSchedule(
    input,
    input.days[0].places,
    null,
    {
      arrivalTime: '16:00',
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
      averagePace: 5,
    },
  );
  assert.equal(schedule.days[0].startTime, '16:00');
  assert.ok(schedule.days[0].items[0].startTime >= '16:00');
});

void test('departure overrides the Pace 1 normal finish', () => {
  const input = grouping([place('early-departure', 3)]);
  const schedule = createDeterministicDraftSchedule(
    input,
    input.days[0].places,
    null,
    {
      arrivalTime: null,
      departureTime: '14:30',
      arrivalPoint: null,
      departurePoint: null,
      averagePace: 1,
    },
  );
  assert.equal(schedule.days[0].endTime, '14:30');
  assert.ok(schedule.days[0].items.every((item) => item.endTime <= '14:30'));
});

void test('pace profiles centralize daily and meal windows', () => {
  assert.deepEqual(
    {
      start: derivePaceProfile(1).earliestActivityMinutes,
      end: derivePaceProfile(1).targetReturnMinutes,
      lunch: derivePaceProfile(1).lunch,
      dinner: derivePaceProfile(1).dinner,
    },
    {
      start: 11 * 60,
      end: 22 * 60,
      lunch: {
        startMinutes: 13 * 60,
        endMinutes: 14 * 60 + 30,
        durationMinutes: 60,
      },
      dinner: {
        startMinutes: 19 * 60,
        endMinutes: 20 * 60 + 30,
        durationMinutes: 60,
      },
    },
  );
});

void test('Day 1 starts at or after the arrival boundary', () => {
  const input = grouping([place('shared', 3)]);
  const schedule = createDeterministicDraftSchedule(
    input,
    input.days[0].places,
    null,
    {
      arrivalTime: '14:00',
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
    },
  );
  assert.equal(schedule.days[0].startTime, '14:00');
  assert.equal(schedule.days[0].items[0].startTime, '14:00');
});

void test('final-day capacity protects consensus and overflows lower priority', () => {
  const input = grouping([
    place('single', 1, 150),
    place('unanimous', 3, 150),
    place('majority', 2, 150),
  ]);
  const first = createDeterministicDraftSchedule(
    input,
    input.days[0].places,
    null,
    {
      arrivalTime: '09:00',
      departureTime: '14:00',
      arrivalPoint: null,
      departurePoint: airport,
    },
  );
  const second = createDeterministicDraftSchedule(
    input,
    input.days[0].places,
    null,
    {
      arrivalTime: '09:00',
      departureTime: '14:00',
      arrivalPoint: null,
      departurePoint: airport,
    },
  );
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.days[0].items.map((item) => item.placeId),
    ['unanimous'],
  );
  assert.deepEqual(
    first.days[0].overflow.map((item) => item.placeId),
    ['majority', 'single'],
  );
  assert.ok(first.days[0].items.every((item) => item.endTime <= '14:00'));
});

void test('grounded endpoints map around attractions without becoming itinerary items', () => {
  const item = {
    id: 'stop-1',
    place: { longitude: 103.76, latitude: 1.47 },
  } as ItineraryItemView;
  assert.deepEqual(
    buildRoutingPoints([item], { start: airport, end: airport }).map(
      (point) => point.id,
    ),
    [ARRIVAL_ENDPOINT_ID, 'stop-1', DEPARTURE_ENDPOINT_ID],
  );
});
