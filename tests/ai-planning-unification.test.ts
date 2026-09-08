import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import type { CandidatePlace } from '../lib/malaysia-places/types';
import {
  createAutomaticPlanningSelection,
  createPlanningIntelligencePlan,
  persistPlanningIntelligencePlan,
} from '../lib/malaysia-places/planning-orchestration-core';
import {
  compareSelectionPriority,
  consensusSelectionPriority,
} from '../lib/malaysia-places/selection-priority-core';
import type { RankedCandidate } from '../lib/malaysia-places/group-ranking';

function candidate(
  id: string,
  score: number,
  overrides: Partial<CandidatePlace> = {},
): CandidatePlace {
  return {
    id,
    googlePlaceId: `google-${id}`,
    name: `Place ${id}`,
    country: 'Malaysia',
    state: 'Kuala Lumpur',
    city: 'Kuala Lumpur',
    area: id.includes('north') ? 'North' : 'Central',
    latitude: id.includes('north') ? 3.2 : 3.14,
    longitude: 101.7,
    category: 'tourist_attraction',
    subcategories: ['tourist_attraction'],
    estimatedDurationMinutes: 90,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: 'any',
    openingPeriods: null,
    cultureScore: 4,
    foodScore: 3,
    natureScore: 3,
    shoppingScore: 3,
    adventureScore: 2,
    nightlifeScore: 2,
    photographyScore: 4,
    budgetScore: 3,
    googleRating: 4.6,
    googleRatingCount: 500,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    photoName: null,
    photoWidthPx: null,
    photoHeightPx: null,
    photoAttributions: [],
    source: 'google_places',
    lastVerifiedAt: '2026-09-08T00:00:00.000Z',
    score,
    reasons: ['Recommended for the group’s strongest interests.'],
    ...overrides,
  };
}

function candidates(count = 30) {
  return Array.from({ length: count }, (_, index) =>
    candidate(`candidate-${String(index).padStart(2, '0')}`, 95 - index),
  );
}

function constraints(averagePace = 3) {
  return {
    arrivalTime: null,
    departureTime: null,
    arrivalPoint: null,
    departurePoint: null,
    averagePace,
    startDate: '2026-09-07',
  };
}

void test('AI selection uses grounded PI-4A identities without fake votes', () => {
  const selection = createAutomaticPlanningSelection(candidates(), {
    averagePace: 5,
    durationDays: 3,
  });
  assert.ok(selection.selected.length > 8);
  assert.ok(
    selection.selected.every(
      (place) =>
        place.googlePlaceId &&
        place.latitude !== null &&
        place.longitude !== null &&
        place.voteCount === 0 &&
        place.totalMembers === 0 &&
        place.selectionPriority?.source === 'recommendation',
    ),
  );
});

void test('automatic selection size follows PI-4A.1 usable capacity', () => {
  const pool = candidates();
  const oneDay = createAutomaticPlanningSelection(pool, {
    averagePace: 5,
    durationDays: 1,
  });
  const threeDays = createAutomaticPlanningSelection(pool, {
    averagePace: 5,
    durationDays: 3,
  });
  const constrained = createAutomaticPlanningSelection(pool, {
    averagePace: 5,
    durationDays: 3,
    arrivalTime: '18:00',
    departureTime: '12:00',
  });
  assert.ok(oneDay.selected.length < threeDays.selected.length);
  assert.ok(constrained.selected.length < threeDays.selected.length);
});

void test('shared AI orchestration uses PI-1 Pace windows', async () => {
  const pool = [candidate('pace', 90)];
  const relaxedSelection = createAutomaticPlanningSelection(pool, {
    averagePace: 1,
    durationDays: 1,
  });
  const packedSelection = createAutomaticPlanningSelection(pool, {
    averagePace: 5,
    durationDays: 1,
  });
  const relaxed = await createPlanningIntelligencePlan({
    destination: 'Kuala Lumpur',
    durationDays: 1,
    candidates: relaxedSelection.candidatePool,
    selected: relaxedSelection.selected,
    constraints: constraints(1),
  });
  const packed = await createPlanningIntelligencePlan({
    destination: 'Kuala Lumpur',
    durationDays: 1,
    candidates: packedSelection.candidatePool,
    selected: packedSelection.selected,
    constraints: constraints(5),
  });
  assert.equal(relaxed.draftSchedule.days[0].startTime, '11:00');
  assert.equal(packed.draftSchedule.days[0].startTime, '09:00');
});

void test('shared AI orchestration respects known opening hours', async () => {
  const pool = [
    candidate('afternoon-only', 90, {
      openingPeriods: [
        {
          openDay: 1,
          openMinutes: 14 * 60,
          closeDay: 1,
          closeMinutes: 17 * 60,
        },
      ],
    }),
  ];
  const selection = createAutomaticPlanningSelection(pool, {
    averagePace: 3,
    durationDays: 1,
  });
  const plan = await createPlanningIntelligencePlan({
    destination: 'Kuala Lumpur',
    durationDays: 1,
    candidates: selection.candidatePool,
    selected: selection.selected,
    constraints: constraints(),
  });
  assert.equal(plan.finalValidation.status, 'PASS');
  assert.equal(plan.draftSchedule.days[0].items[0]?.startTime, '14:00');
});

void test('shared orchestration owns clustering and route validation', async () => {
  const pool = [candidate('central', 90), candidate('north', 89)];
  const selection = createAutomaticPlanningSelection(pool, {
    averagePace: 3,
    durationDays: 2,
  });
  let routeValidationCalls = 0;
  const plan = await createPlanningIntelligencePlan({
    destination: 'Kuala Lumpur',
    durationDays: 2,
    candidates: selection.candidatePool,
    selected: selection.selected,
    constraints: constraints(),
    routeValidator: async (input) => {
      routeValidationCalls += 1;
      return input.schedule;
    },
  });
  assert.equal(routeValidationCalls, 1);
  assert.equal(plan.dayGroups.days.length, 2);
  assert.equal(plan.finalValidation.status, 'PASS');
});

void test('PI-4B blocks persistence before an invalid AI plan can write', async () => {
  const pool = [
    candidate('ungrounded', 90, {
      googlePlaceId: null,
      latitude: null,
      longitude: null,
    }),
  ];
  const selection = createAutomaticPlanningSelection(pool, {
    averagePace: 3,
    durationDays: 1,
  });
  const plan = await createPlanningIntelligencePlan({
    destination: 'Kuala Lumpur',
    durationDays: 1,
    candidates: selection.candidatePool,
    selected: selection.selected,
    constraints: constraints(),
  });
  let persisted = false;
  const result = await persistPlanningIntelligencePlan(plan, async () => {
    persisted = true;
  });
  assert.equal(plan.finalValidation.status, 'FAIL');
  assert.equal(result.persisted, false);
  assert.equal(persisted, false);
});

void test('lower-ranked AI selections overflow before stronger recommendations', async () => {
  const pool = Array.from({ length: 12 }, (_, index) =>
    candidate(`priority-${String(index).padStart(2, '0')}`, 95 - index, {
      estimatedDurationMinutes: 240,
    }),
  );
  const selection = createAutomaticPlanningSelection(pool, {
    averagePace: 5,
    durationDays: 1,
  });
  const plan = await createPlanningIntelligencePlan({
    destination: 'Kuala Lumpur',
    durationDays: 1,
    candidates: selection.candidatePool,
    selected: selection.selected,
    constraints: constraints(5),
  });
  const rankById = new Map(
    selection.selected.map((place) => [
      place.id,
      place.selectionPriority?.source === 'recommendation'
        ? place.selectionPriority.rank
        : Number.POSITIVE_INFINITY,
    ]),
  );
  const scheduledRanks = plan.draftSchedule.days[0].items.map((item) =>
    rankById.get(item.placeId)!,
  );
  const overflowRanks = plan.draftSchedule.days[0].overflow.map((item) =>
    rankById.get(item.placeId)!,
  );
  assert.ok(scheduledRanks.length > 0);
  assert.ok(overflowRanks.length > 0);
  assert.ok(Math.max(...scheduledRanks) < Math.min(...overflowRanks));
});

void test('collaborative consensus priority remains unchanged', () => {
  const base = candidate('consensus', 80);
  const unanimous: RankedCandidate = {
    ...base,
    id: 'unanimous',
    name: 'Unanimous',
    voteCount: 3,
    totalMembers: 3,
    currentUserSelected: true,
    groupScore: 85,
    selectionPriority: consensusSelectionPriority(),
  };
  const majority: RankedCandidate = {
    ...unanimous,
    id: 'majority',
    name: 'Majority',
    voteCount: 2,
  };
  assert.deepEqual(
    [majority, unanimous].sort(compareSelectionPriority).map(({ id }) => id),
    ['unanimous', 'majority'],
  );
});

void test('the AI itinerary route has no legacy OpenRouter scheduling path', () => {
  const route = readFileSync('app/api/trips/[id]/itinerary/route.ts', 'utf8');
  const planning = readFileSync('lib/phase2/planning.ts', 'utf8');
  assert.doesNotMatch(
    route,
    /requestStructuredJson|generateGroundedItinerary|applyTimeBoundaries/,
  );
  assert.doesNotMatch(planning, /grounded_itinerary|stopsForPace/);
  assert.equal(existsSync('lib/phase2/time-boundaries-core.ts'), false);
});
