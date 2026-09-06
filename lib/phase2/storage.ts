import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type {
  ExplorationPreference,
  ItineraryItemView,
  ItineraryPageData,
  ItineraryPlace,
} from './types';
import { parseGeographicScope } from './validation';
import {
  canControlTripSetup,
  parseTripPlanningMode,
  parseTripSetupStage,
} from '@/lib/trips/setup-core';

function explorationPreference(value: string): ExplorationPreference {
  return value === 'stay_local' ||
    value === 'explore_freely' ||
    value === 'nearby_day_trips'
    ? value
    : 'nearby_day_trips';
}

export async function loadItineraryPageData(
  supabase: SupabaseClient<Database>,
  tripId: string,
  currentUserId?: string,
): Promise<ItineraryPageData | null> {
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select(
      'id, created_by, destination, destination_input, duration_days, start_date, end_date, exploration_preference, geographic_scope, planning_mode, setup_stage',
    )
    .eq('id', tripId)
    .maybeSingle();
  if (tripError) throw tripError;
  if (!trip) return null;

  const { data: hostMember, error: hostError } = await supabase
    .from('trip_members')
    .select('display_name')
    .eq('trip_id', tripId)
    .eq('user_id', trip.created_by)
    .maybeSingle();
  if (hostError) throw hostError;

  const { data: itemRows, error: itemError } = await supabase
    .from('itinerary_items')
    .select(
      'id, place_id, day_number, sort_order, planned_time, estimated_cost, estimated_duration_minutes, reason, day_theme',
    )
    .eq('trip_id', tripId)
    .eq('generation_source', 'phase2')
    .order('day_number', { ascending: true })
    .order('sort_order', { ascending: true });
  if (itemError) throw itemError;

  const placeIds = Array.from(
    new Set(
      (itemRows ?? [])
        .map((item) => item.place_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const placeRows = placeIds.length
    ? await supabase
        .from('places')
        .select(
          'id, external_place_id, name, formatted_address, latitude, longitude, rating, rating_count, price_level, types',
        )
        .in('id', placeIds)
    : { data: [], error: null };
  if (placeRows.error) throw placeRows.error;

  const places = new Map(
    (placeRows.data ?? []).map((place) => [
      place.id,
      {
        externalPlaceId: place.external_place_id ?? '',
        name: place.name,
        address: place.formatted_address,
        latitude: place.latitude,
        longitude: place.longitude,
        rating: place.rating === null ? null : Number(place.rating),
        ratingCount: place.rating_count,
        priceLevel: place.price_level,
        types: place.types,
      } satisfies ItineraryPlace,
    ]),
  );

  const items: ItineraryItemView[] = (itemRows ?? []).flatMap((item) => {
    const place = item.place_id ? places.get(item.place_id) : null;
    if (!place || !item.day_number || !item.planned_time) return [];
    return [
      {
        id: item.id,
        day: item.day_number,
        sortOrder: item.sort_order,
        plannedTime: item.planned_time.slice(0, 5),
        estimatedDurationMinutes: item.estimated_duration_minutes ?? 60,
        estimatedCost:
          item.estimated_cost === null ? null : Number(item.estimated_cost),
        reason: item.reason ?? 'Selected for the group plan.',
        dayTheme: item.day_theme ?? `Day ${item.day_number}`,
        place,
      },
    ];
  });
  const durationDays = trip.duration_days ?? 3;
  const geographicScope = parseGeographicScope(
    trip.geographic_scope,
    durationDays,
  );
  const tripData = {
    id: trip.id,
    destination: trip.destination,
    destinationInput: trip.destination_input,
    durationDays,
    startDate: trip.start_date,
    endDate: trip.end_date,
    explorationPreference: explorationPreference(trip.exploration_preference),
    geographicScope,
    planningMode: parseTripPlanningMode(trip.planning_mode),
    setupStage: parseTripSetupStage(trip.setup_stage),
    isHost: currentUserId
      ? canControlTripSetup(trip.created_by, currentUserId)
      : false,
    hostDisplayName: hostMember?.display_name ?? null,
  };

  if (items.length === 0 || !trip.destination) {
    return {
      trip: tripData,
      itinerary: null,
    };
  }

  const days = Array.from(
    new Map(
      items.map((item) => [
        item.day,
        {
          day: item.day,
          theme: item.dayTheme,
          area:
            geographicScope?.days.find((scopeDay) => scopeDay.day === item.day)
              ?.area ?? null,
          mode:
            geographicScope?.days.find((scopeDay) => scopeDay.day === item.day)
              ?.mode ?? null,
          items: items.filter((candidate) => candidate.day === item.day),
        },
      ]),
    ).values(),
  ).sort((a, b) => a.day - b.day);

  return {
    trip: tripData,
    itinerary: {
      destination: trip.destination,
      durationDays,
      days,
    },
  };
}
