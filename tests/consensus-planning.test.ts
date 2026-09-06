import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareConsensusPriority,
  consensusTiers,
} from '../lib/malaysia-places/consensus-core';
import { selectionCompletionSummary } from '../lib/malaysia-places/selection-completion-core';
import { createDeterministicDraftSchedule } from '../lib/malaysia-places/deterministic-scheduling-core';
import type {
  DayClusterSelection,
  GeographicDayClustering,
} from '../lib/malaysia-places/day-clustering-core';

function place(
  id: string,
  voteCount: number,
  durationMinutes = 300,
): DayClusterSelection {
  return {
    id,
    googlePlaceId: id,
    name: `Place ${id}`,
    country: 'Malaysia',
    state: 'Kuala Lumpur',
    city: 'Kuala Lumpur',
    area: 'KLCC',
    latitude: 3.15,
    longitude: 101.71,
    category: 'tourist_attraction',
    subcategories: [],
    estimatedDurationMinutes: durationMinutes,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: 'any',
    cultureScore: 80,
    foodScore: 50,
    natureScore: 20,
    shoppingScore: 40,
    adventureScore: 20,
    nightlifeScore: 20,
    photographyScore: 80,
    budgetScore: 60,
    googleRating: 4.5,
    googleRatingCount: 100,
    priceLevel: null,
    source: 'google_places',
    lastVerifiedAt: null,
    score: 80,
    reasons: ['Strong visitor rating'],
    voteCount,
    totalMembers: 3,
    groupScore: 80,
  };
}

void test('member completion is explicit and requires every planning member', () => {
  const members = [
    { userId: 'a', displayName: 'Ethan', completed: true },
    { userId: 'b', displayName: 'Alex', completed: false },
  ];
  assert.deepEqual(selectionCompletionSummary(members, 'a'), {
    completedMembers: 1,
    planningMembers: 2,
    allCompleted: false,
    currentUserCompleted: true,
  });
  assert.equal(
    selectionCompletionSummary(
      members.map((member) => ({ ...member, completed: true })),
      'b',
    ).allCompleted,
    true,
  );
});

void test('consensus result separates unanimous and additional choices', () => {
  const places = [place('single', 1), place('unanimous', 3), place('majority', 2)];
  const tiers = consensusTiers(places, 3);
  assert.deepEqual(tiers.unanimous.map(({ id }) => id), ['unanimous']);
  assert.deepEqual(tiers.additional.map(({ id }) => id), [
    'majority',
    'single',
  ]);
  assert.deepEqual(
    [...places].sort(compareConsensusPriority).map(({ id }) => id),
    ['unanimous', 'majority', 'single'],
  );
});

void test('scheduler protects consensus capacity and remains deterministic', () => {
  const unanimous = place('unanimous', 3);
  const majority = place('majority', 2);
  const single = place('single', 1);
  const grouping: GeographicDayClustering = {
    status: 'ready',
    activeDays: 1,
    unlocatedPlaceCount: 0,
    days: [
      {
        day: 1,
        places: [single, majority, unanimous],
        centroid: { latitude: 3.15, longitude: 101.71 },
        placeCount: 3,
        geographicSpreadKm: 0,
        missingCoordinatePlaceCount: 0,
      },
    ],
  };

  const first = createDeterministicDraftSchedule(
    grouping,
    grouping.days[0].places,
    'KLCC',
  );
  const second = createDeterministicDraftSchedule(
    grouping,
    grouping.days[0].places,
    'KLCC',
  );
  assert.deepEqual(second, first);
  assert.deepEqual(first.days[0].items.map(({ placeId }) => placeId), [
    'unanimous',
    'majority',
  ]);
  assert.deepEqual(first.days[0].overflow.map(({ placeId }) => placeId), [
    'single',
  ]);
  assert.match(
    first.days[0].items[0].schedulingReasons.join(' '),
    /shared priority/,
  );
});
