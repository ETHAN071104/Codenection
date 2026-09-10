import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import type { ItineraryItemView } from '@/lib/phase2/types';
import { mapMalaysiaPlaceRow } from '@/lib/malaysia-places/candidates-core';
import type { RankedCandidate } from '@/lib/malaysia-places/group-ranking';
import { consensusSelectionPriority } from '@/lib/malaysia-places/selection-priority-core';
import { createServerPlanningIntelligencePlan } from '@/lib/malaysia-places/planning-orchestration';
import {
  endpointToJson,
  tripDayRouteAnchors,
  type TripEndpoint,
} from '@/lib/trips/travel-boundaries';
import {
  ARRIVAL_ENDPOINT_ID,
  DEPARTURE_ENDPOINT_ID,
  STAY_ENDPOINT_ID,
} from '@/lib/routing/route-points-core';
import {
  getDrivingRoute,
  OpenRouteServiceError,
} from '@/lib/routing/openrouteservice';
import type { TripRoute } from '@/lib/routing/types';
import type { PlannerMutationResponse } from './types';
import { isStayReplanPersistable } from './stay-replan-core';

const EMPTY_ROUTE: TripRoute = {
  geometry: null,
  totalDistanceMeters: 0,
  totalDurationSeconds: 0,
  segments: [],
};

function fallbackCandidate(
  item: ItineraryItemView,
  rank: number,
): RankedCandidate {
  return {
    id: item.place.externalPlaceId,
    googlePlaceId: item.place.externalPlaceId,
    name: item.place.name,
    country: '',
    state: null,
    city: null,
    area: null,
    latitude: item.place.latitude,
    longitude: item.place.longitude,
    category: item.place.types[0] ?? null,
    subcategories: item.place.types,
    estimatedDurationMinutes: item.estimatedDurationMinutes,
    indoorOutdoor: null,
    bestTimeOfDay: null,
    openingPeriods: item.place.openingPeriods ?? null,
    cultureScore: null,
    foodScore: null,
    natureScore: null,
    shoppingScore: null,
    adventureScore: null,
    nightlifeScore: null,
    photographyScore: null,
    budgetScore: null,
    googleRating: item.place.rating,
    googleRatingCount: item.place.ratingCount,
    priceLevel: item.place.priceLevel,
    photoName: item.place.photo?.name ?? null,
    photoWidthPx: item.place.photo?.widthPx ?? null,
    photoHeightPx: item.place.photo?.heightPx ?? null,
    photoAttributions: item.place.photo?.attributions ?? [],
    source: 'persisted_itinerary',
    lastVerifiedAt: null,
    score: Math.max(1, 100 - rank),
    reasons: [item.reason],
    voteCount: 1,
    totalMembers: 1,
    currentUserSelected: true,
    groupScore: 100,
    selectionPriority: consensusSelectionPriority(),
  };
}

export async function applyStayAnchorReplan({
  supabase,
  tripId,
  dayNumber,
  stayAnchor,
}: {
  supabase: SupabaseClient<Database>;
  tripId: string;
  dayNumber: number;
  stayAnchor: TripEndpoint;
}): Promise<PlannerMutationResponse> {
  const current = await loadItineraryPageData(supabase, tripId);
  if (!current?.itinerary || !current.trip.destination) {
    throw new Error('TRIP_UNAVAILABLE');
  }
  const existingItems = current.itinerary.days.flatMap((day) => day.items);
  if (existingItems.length === 0) throw new Error('ITINERARY_UNAVAILABLE');

  const googleIds = existingItems.map((item) => item.place.externalPlaceId);
  const [
    { data: placeRows, error: placeError },
    { data: summaryRows, error: summaryError },
  ] = await Promise.all([
    supabase
      .from('malaysia_places')
      .select('*')
      .in('google_place_id', googleIds),
    supabase.rpc('get_group_preference_summary', { p_trip_id: tripId }),
  ]);
  if (placeError) throw placeError;
  if (summaryError) throw summaryError;

  const storedByGoogleId = new Map(
    (placeRows ?? []).map((row) => {
      const mapped = mapMalaysiaPlaceRow(row as Record<string, unknown>);
      return [mapped.googlePlaceId, mapped] as const;
    }),
  );
  const selected = existingItems.map((item, rank) => {
    const stored = storedByGoogleId.get(item.place.externalPlaceId);
    if (!stored) return fallbackCandidate(item, rank);
    return {
      ...stored,
      estimatedDurationMinutes:
        stored.estimatedDurationMinutes ?? item.estimatedDurationMinutes,
      score: Math.max(1, 100 - rank),
      reasons: [item.reason],
      voteCount: 1,
      totalMembers: 1,
      currentUserSelected: true,
      groupScore: 100,
      selectionPriority: consensusSelectionPriority(),
    } satisfies RankedCandidate;
  });

  const plan = await createServerPlanningIntelligencePlan({
    destination: current.trip.destination,
    durationDays: current.trip.durationDays,
    candidates: selected,
    selected,
    constraints: {
      arrivalTime: current.trip.arrivalTime,
      departureTime: current.trip.departureTime,
      arrivalPoint: current.trip.arrivalPoint,
      departurePoint: current.trip.departurePoint,
      stayAnchor,
      averagePace: Number(summaryRows?.[0]?.average_pace) || 3,
      startDate: current.trip.startDate,
    },
    validateRoutes: true,
  });
  const desired = plan.desiredItinerary;
  if (
    !isStayReplanPersistable({
      finalStatus: plan.finalValidation.status,
      hasDesiredItinerary: Boolean(desired),
      overflowPlaceCount: plan.draftSchedule.overflowPlaceCount,
      desiredItemCount: desired?.items.length ?? 0,
      existingItemCount: existingItems.length,
    }) ||
    !desired
  ) {
    throw new Error('FINAL_ITINERARY_INFEASIBLE');
  }

  const existingByGoogleId = new Map(
    existingItems.map((item) => [item.place.externalPlaceId, item]),
  );
  const schedule = desired.items.map((item) => {
    const existing = existingByGoogleId.get(item.externalPlaceId);
    if (!existing) throw new Error('ITINERARY_SAVE_FAILED');
    return {
      itemId: existing.id,
      day: item.day,
      sortOrder: item.sortOrder,
      plannedTime: item.plannedTime,
      estimatedDurationMinutes: item.estimatedDurationMinutes,
      dayTheme: item.dayTheme,
    };
  });

  const { data: saveRows, error: saveError } = await supabase.rpc(
    'apply_stay_anchor_replan',
    {
      p_trip_id: tripId,
      p_stay_anchor: endpointToJson(stayAnchor),
      p_schedule: schedule as unknown as Json,
    },
  );
  if (saveError || Number(saveRows?.[0]?.saved_items) !== schedule.length) {
    throw saveError ?? new Error('ITINERARY_SAVE_FAILED');
  }

  const data = await loadItineraryPageData(supabase, tripId);
  if (!data?.itinerary) throw new Error('TRIP_UNAVAILABLE');
  const routeDay =
    data.itinerary.days.find((day) => day.day === dayNumber) ??
    data.itinerary.days[0];
  let route = EMPTY_ROUTE;
  if (routeDay) {
    const anchors = tripDayRouteAnchors({
      firstDay: routeDay.day === data.itinerary.days[0]?.day,
      finalDay: routeDay.day === data.itinerary.days.at(-1)?.day,
      arrivalPoint: data.trip.arrivalPoint,
      departurePoint: data.trip.departurePoint,
      stayAnchor: data.trip.stayAnchor,
    });
    try {
      route = await getDrivingRoute(routeDay.items, {
        start: anchors.start,
        end: anchors.end,
        startId:
          anchors.startKind === 'arrival'
            ? ARRIVAL_ENDPOINT_ID
            : STAY_ENDPOINT_ID,
        endId:
          anchors.endKind === 'departure'
            ? DEPARTURE_ENDPOINT_ID
            : STAY_ENDPOINT_ID,
      });
    } catch (error) {
      if (!(error instanceof OpenRouteServiceError)) throw error;
    }
  }
  return {
    data,
    day: routeDay?.day ?? dayNumber,
    route,
    message: `Stay updated to ${stayAnchor.name}. I replanned the trip around your hotel.`,
  };
}
