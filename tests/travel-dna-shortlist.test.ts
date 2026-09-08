import assert from 'node:assert/strict';
import test from 'node:test';
import type { GroupPreferenceSummary } from '../lib/preferences/model';
import { groupScore } from '../lib/malaysia-places/group-ranking';
import { scoreMalaysiaPlace } from '../lib/malaysia-places/recommendation';
import {
  createSuggestedShortlist,
  suggestedShortlistSize,
} from '../lib/malaysia-places/suggested-shortlist-core';
import type {
  CandidatePlace,
  MalaysiaPlace,
} from '../lib/malaysia-places/types';

function dna(
  interests: GroupPreferenceSummary['average_interests'],
  budget: number | null = 700,
  unlimitedMembers = 0,
): GroupPreferenceSummary {
  return {
    finite_budget_average: budget,
    unlimited_members: unlimitedMembers,
    average_pace: 3,
    average_interests: interests,
  };
}

function place(
  id: string,
  category: string,
  overrides: Partial<MalaysiaPlace> = {},
): MalaysiaPlace {
  return {
    id,
    googlePlaceId: `google-${id}`,
    name: `Place ${id}`,
    country: 'Malaysia',
    state: 'Kuala Lumpur',
    city: 'Kuala Lumpur',
    area: 'Central',
    latitude: 3.15,
    longitude: 101.7,
    category,
    subcategories: [category],
    estimatedDurationMinutes: 90,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: 'any',
    openingPeriods: null,
    cultureScore: null,
    foodScore: null,
    natureScore: null,
    shoppingScore: null,
    adventureScore: null,
    nightlifeScore: null,
    photographyScore: null,
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
    ...overrides,
  };
}

function candidate(id: string, score = 70): CandidatePlace {
  return {
    ...place(id, 'tourist_attraction'),
    score,
    reasons: ['Grounded place for this destination.'],
  };
}

const foodHeavy = dna({
  food_dining: 5,
  history_heritage: 1,
  nature_viewpoints: 1,
  instagrammable_cafes: 1,
});
const natureHeavy = dna({
  food_dining: 1,
  history_heritage: 1,
  nature_viewpoints: 5,
  instagrammable_cafes: 1,
});

void test('food-heavy Travel DNA ranks food-related places higher', () => {
  const restaurant = scoreMalaysiaPlace(
    place('restaurant', 'restaurant'),
    foodHeavy,
  );
  const park = scoreMalaysiaPlace(place('park', 'park'), foodHeavy);
  assert.ok(restaurant.score > park.score);
  assert.ok(restaurant.reasons.some((reason) => reason.includes('food')));
});

void test('nature-heavy Travel DNA changes the ranking', () => {
  const restaurant = scoreMalaysiaPlace(
    place('restaurant', 'restaurant'),
    natureHeavy,
  );
  const park = scoreMalaysiaPlace(place('park', 'park'), natureHeavy);
  assert.ok(park.score > restaurant.score);
  assert.ok(park.reasons.some((reason) => reason.includes('nature')));
});

void test('Pace 1 creates a smaller shortlist than Pace 5', () => {
  const pool = Array.from({ length: 20 }, (_, index) =>
    candidate(`candidate-${String(index).padStart(2, '0')}`),
  );
  const relaxed = createSuggestedShortlist(pool, {
    averagePace: 1,
    durationDays: 4,
  });
  const packed = createSuggestedShortlist(pool, {
    averagePace: 5,
    durationDays: 4,
  });
  assert.ok(relaxed.length < packed.length);
  assert.equal(relaxed.length, suggestedShortlistSize(1, 4));
  assert.equal(packed.length, suggestedShortlistSize(5, 4));
});

void test('low-budget profiles prefer supported lower-cost evidence', () => {
  const lowBudget = dna(
    {
      food_dining: 3,
      history_heritage: 3,
      nature_viewpoints: 3,
      instagrammable_cafes: 3,
    },
    300,
  );
  const free = scoreMalaysiaPlace(
    place('free', 'tourist_attraction', { priceLevel: 'PRICE_LEVEL_FREE' }),
    lowBudget,
  );
  const expensive = scoreMalaysiaPlace(
    place('expensive', 'tourist_attraction', {
      priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE',
    }),
    lowBudget,
  );
  assert.ok(free.score > expensive.score);
  assert.ok(free.reasons.some((reason) => reason.includes('lower-cost')));
});

void test('unknown price remains neutral and does not reject a candidate', () => {
  const lowBudget = dna(foodHeavy.average_interests, 300);
  const unknownPlace = place('unknown-price', 'restaurant', {
    priceLevel: null,
    budgetScore: null,
  });
  const scored = {
    ...unknownPlace,
    ...scoreMalaysiaPlace(unknownPlace, lowBudget),
  };
  const shortlist = createSuggestedShortlist([scored], {
    averagePace: 1,
    durationDays: 2,
  });
  assert.deepEqual(shortlist.map((item) => item.id), ['unknown-price']);
});

void test('the same group inputs produce the same shared shortlist', () => {
  const pool = Array.from({ length: 16 }, (_, index) =>
    candidate(`shared-${index}`, 80 - (index % 4)),
  );
  const options = { averagePace: 3.4, durationDays: 5 };
  const first = createSuggestedShortlist(pool, options).map((item) => item.id);
  const second = createSuggestedShortlist(
    [...pool].reverse(),
    options,
  ).map((item) => item.id);
  assert.deepEqual(second, first);
});

void test('existing vote-based group scoring remains unchanged', () => {
  assert.equal(groupScore(80, 2, 4), 73);
  assert.equal(groupScore(80, 0, 4), 60);
});
