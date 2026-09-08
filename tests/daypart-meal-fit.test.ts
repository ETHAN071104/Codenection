import assert from 'node:assert/strict';
import test from 'node:test';

import type { DayClusterSelection } from '../lib/malaysia-places/day-clustering-core';
import { createDeterministicDraftSchedule } from '../lib/malaysia-places/deterministic-scheduling-core';

function place(
  id: string,
  category: string,
  subcategories: string[] = [],
): DayClusterSelection {
  return {
    id,
    googlePlaceId: `google-${id}`,
    name: `Place ${id}`,
    country: 'Malaysia',
    state: 'Kuala Lumpur',
    city: 'Kuala Lumpur',
    area: 'Central',
    latitude: 3.14,
    longitude: 101.69,
    category,
    subcategories,
    estimatedDurationMinutes: null,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: null,
    openingPeriods: null,
    cultureScore: 4,
    foodScore: 4,
    natureScore: 3,
    shoppingScore: 3,
    adventureScore: 2,
    nightlifeScore: 3,
    photographyScore: 4,
    budgetScore: 3,
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
    voteCount: 1,
    totalMembers: 1,
    groupScore: 80,
  };
}

function schedule(
  selected: DayClusterSelection,
  arrivalTime: string | null = null,
) {
  return createDeterministicDraftSchedule(
    {
      status: 'ready',
      activeDays: 1,
      unlocatedPlaceCount: 0,
      days: [{
        day: 1,
        places: [selected],
        centroid: { latitude: selected.latitude!, longitude: selected.longitude! },
        placeCount: 1,
        geographicSpreadKm: 0,
        missingCoordinatePlaceCount: 0,
      }],
    },
    [selected],
    null,
    {
      arrivalTime,
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
      averagePace: 3,
      startDate: '2026-09-07',
    },
  );
}

void test('museum is not scheduled after its known closing time', () => {
  const museum = {
    ...place('museum', 'museum'),
    openingPeriods: [{
      openDay: 1,
      openMinutes: 9 * 60,
      closeDay: 1,
      closeMinutes: 15 * 60,
    }],
  };
  const result = schedule(museum, '14:00');
  assert.deepEqual(result.days[0].items, []);
  assert.deepEqual(result.days[0].overflow.map(({ placeId }) => placeId), [
    'museum',
  ]);
});

void test('night-market style places prefer dinner or evening', () => {
  const result = schedule(place('night-market', 'market', ['night_market']));
  assert.ok(result.days[0].items[0].startTime >= '18:30');
  assert.match(
    result.days[0].items[0].schedulingReasons.join(' '),
    /dinner|evening/,
  );
});

void test('food courts prefer lunch or dinner instead of morning', () => {
  const result = schedule(place('food-court', 'food_court'));
  assert.ok(result.days[0].items[0].startTime >= '12:30');
  assert.ok(result.days[0].items[0].startTime < '13:30');
  assert.match(result.days[0].breaks[0].reason, /suitable for lunch/);
});

void test('cafes can fit in the morning', () => {
  const result = schedule(place('cafe', 'cafe'));
  assert.ok(result.days[0].items[0].startTime < '12:00');
});

void test('missing opening hours do not make a place unusable', () => {
  const result = schedule(place('unknown-hours', 'museum'));
  assert.deepEqual(result.days[0].items.map(({ placeId }) => placeId), [
    'unknown-hours',
  ]);
});
