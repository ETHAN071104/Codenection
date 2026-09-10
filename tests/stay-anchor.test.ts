import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlaceCandidate } from '../lib/phase2/types';
import type { DayClusterSelection } from '../lib/malaysia-places/day-clustering-core';
import { createDeterministicDraftSchedule } from '../lib/malaysia-places/deterministic-scheduling-core';
import { selectStayPlaceResolution } from '../lib/phase2/stay-grounding-core';
import { extractStayQuery } from '../lib/planner/stay-intent-core';
import { isStayReplanPersistable } from '../lib/planner/stay-replan-core';
import {
  ARRIVAL_ENDPOINT_ID,
  DEPARTURE_ENDPOINT_ID,
  STAY_ENDPOINT_ID,
  buildRoutingPoints,
} from '../lib/routing/route-points-core';
import {
  tripDayRouteAnchors,
  type TripEndpoint,
} from '../lib/trips/travel-boundaries';
import type { ItineraryItemView } from '../lib/phase2/types';

const arrival: TripEndpoint = {
  googlePlaceId: 'arrival',
  name: 'Arrival Airport',
  address: 'Arrival address',
  latitude: 3.2,
  longitude: 101.6,
};
const departure: TripEndpoint = {
  googlePlaceId: 'departure',
  name: 'Departure Airport',
  address: 'Departure address',
  latitude: 3.3,
  longitude: 101.7,
};
const stay: TripEndpoint = {
  googlePlaceId: 'stay',
  name: 'Grounded Hotel',
  address: 'Hotel address',
  latitude: 3.15,
  longitude: 101.71,
};
const item = {
  id: 'attraction-1',
  place: { longitude: 101.72, latitude: 3.16 },
} as ItineraryItemView;

function idsFor(anchors: ReturnType<typeof tripDayRouteAnchors>) {
  return buildRoutingPoints([item], {
    start: anchors.start,
    end: anchors.end,
    startId:
      anchors.startKind === 'arrival' ? ARRIVAL_ENDPOINT_ID : STAY_ENDPOINT_ID,
    endId:
      anchors.endKind === 'departure'
        ? DEPARTURE_ENDPOINT_ID
        : STAY_ENDPOINT_ID,
  }).map((point) => point.id);
}

function placeCandidate(
  externalPlaceId: string,
  name: string,
  types: string[],
): PlaceCandidate {
  return {
    externalPlaceId,
    name,
    address: `${name}, Kuala Lumpur`,
    latitude: 3.15,
    longitude: 101.71,
    rating: 4.5,
    ratingCount: 100,
    priceLevel: null,
    types,
  };
}

function scheduledPlace(id: string, longitude: number): DayClusterSelection {
  return {
    id,
    googlePlaceId: `google-${id}`,
    name: id,
    country: 'Malaysia',
    state: 'Kuala Lumpur',
    city: 'Kuala Lumpur',
    area: 'Central',
    latitude: 3.15,
    longitude,
    category: 'tourist_attraction',
    subcategories: [],
    estimatedDurationMinutes: 60,
    indoorOutdoor: 'mixed',
    bestTimeOfDay: 'any',
    openingPeriods: null,
    cultureScore: 50,
    foodScore: 50,
    natureScore: 50,
    shoppingScore: 50,
    adventureScore: 50,
    nightlifeScore: 50,
    photographyScore: 50,
    budgetScore: 50,
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
    reasons: ['Selected'],
    voteCount: 1,
    totalMembers: 1,
    groupScore: 80,
  };
}

void test('stay intent extracts only the accommodation query', () => {
  assert.equal(
    extractStayQuery("I'm staying at PARKROYAL COLLECTION Kuala Lumpur."),
    'PARKROYAL COLLECTION Kuala Lumpur',
  );
  assert.equal(
    extractStayQuery('Change our stay to Mandarin Oriental KL.'),
    'Mandarin Oriental KL',
  );
});

void test('exact stay replaces the recommended-area centroid as route anchor', () => {
  const anchors = tripDayRouteAnchors({
    firstDay: false,
    finalDay: false,
    arrivalPoint: null,
    departurePoint: null,
    stayAnchor: stay,
  });
  assert.equal(anchors.start, stay);
  assert.equal(anchors.end, stay);
});

void test('arrival day routes Arrival to activities to Stay', () => {
  assert.deepEqual(
    idsFor(
      tripDayRouteAnchors({
        firstDay: true,
        finalDay: false,
        arrivalPoint: arrival,
        departurePoint: null,
        stayAnchor: stay,
      }),
    ),
    [ARRIVAL_ENDPOINT_ID, item.id, STAY_ENDPOINT_ID],
  );
});

void test('middle day routes Stay to activities to Stay', () => {
  assert.deepEqual(
    idsFor(
      tripDayRouteAnchors({
        firstDay: false,
        finalDay: false,
        arrivalPoint: null,
        departurePoint: null,
        stayAnchor: stay,
      }),
    ),
    [STAY_ENDPOINT_ID, item.id, STAY_ENDPOINT_ID],
  );
});

void test('final day routes Stay to activities to departure airport', () => {
  assert.deepEqual(
    idsFor(
      tripDayRouteAnchors({
        firstDay: false,
        finalDay: true,
        arrivalPoint: null,
        departurePoint: departure,
        stayAnchor: stay,
      }),
    ),
    [STAY_ENDPOINT_ID, item.id, DEPARTURE_ENDPOINT_ID],
  );
});

void test('single day keeps arrival and departure above Stay', () => {
  const anchors = tripDayRouteAnchors({
    firstDay: true,
    finalDay: true,
    arrivalPoint: arrival,
    departurePoint: departure,
    stayAnchor: stay,
  });
  assert.deepEqual(idsFor(anchors), [
    ARRIVAL_ENDPOINT_ID,
    item.id,
    DEPARTURE_ENDPOINT_ID,
  ]);
  assert.notEqual(anchors.end, stay);
});

void test('ambiguous grounded hotels do not produce an applicable stay', () => {
  const resolution = selectStayPlaceResolution('Central Hotel', [
    placeCandidate('hotel-a', 'Central Hotel North', ['hotel']),
    placeCandidate('hotel-b', 'Central Hotel South', ['hotel']),
  ]);
  assert.equal(resolution.status, 'ambiguous');
  assert.equal('place' in resolution, false);
});

void test('invalid non-accommodation result does not produce an applicable stay', () => {
  const resolution = selectStayPlaceResolution('Central', [
    placeCandidate('museum-a', 'Central Museum', ['museum']),
  ]);
  assert.equal(resolution.status, 'not_found');
  assert.equal('place' in resolution, false);
});

void test('changing exact stay deterministically changes geographic ordering', () => {
  const west = scheduledPlace('west', 101.6);
  const east = scheduledPlace('east', 101.8);
  const grouping = {
    status: 'ready' as const,
    activeDays: 1,
    unlocatedPlaceCount: 0,
    days: [
      {
        day: 1,
        places: [west, east],
        centroid: { latitude: 3.15, longitude: 101.7 },
        placeCount: 2,
        geographicSpreadKm: 20,
        missingCoordinatePlaceCount: 0,
      },
    ],
  };
  const orderFrom = (longitude: number) =>
    createDeterministicDraftSchedule(grouping, [west, east], null, {
      arrivalTime: null,
      departureTime: null,
      arrivalPoint: null,
      departurePoint: null,
      stayAnchor: { ...stay, longitude },
      averagePace: 3,
    }).days[0].items.map((entry) => entry.placeId);
  assert.deepEqual(orderFrom(101.55), ['west', 'east']);
  assert.deepEqual(orderFrom(101.85), ['east', 'west']);
});

void test('failed replanning is rejected before the atomic persistence call', () => {
  assert.equal(
    isStayReplanPersistable({
      finalStatus: 'FAIL',
      hasDesiredItinerary: false,
      overflowPlaceCount: 1,
      desiredItemCount: 1,
      existingItemCount: 2,
    }),
    false,
  );
});

void test('Stay remains a route endpoint and is not counted as an attraction', () => {
  const points = buildRoutingPoints([item], {
    start: stay,
    end: stay,
    startId: STAY_ENDPOINT_ID,
    endId: STAY_ENDPOINT_ID,
  });
  assert.equal(points.filter((point) => point.id === item.id).length, 1);
  assert.equal(
    points.filter((point) => point.id === STAY_ENDPOINT_ID).length,
    2,
  );
});
