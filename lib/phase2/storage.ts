import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type {
  ItineraryItemView,
  ItineraryPageData,
  ItineraryPlace,
} from './types';

export async function loadItineraryPageData(
  supabase: SupabaseClient<Database>,
  tripId: string,
): Promise<ItineraryPageData | null> {
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id, destination, destination_input, duration_days')
    .eq('id', tripId)
    .maybeSingle();
  if (tripError) throw tripError;
  if (!trip) return null;

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

  if (items.length === 0 || !trip.destination) {
    return {
      trip: {
        id: trip.id,
        destination: trip.destination,
        destinationInput: trip.destination_input,
        durationDays,
      },
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
          items: items.filter((candidate) => candidate.day === item.day),
        },
      ]),
    ).values(),
  ).sort((a, b) => a.day - b.day);

  return {
    trip: {
      id: trip.id,
      destination: trip.destination,
      destinationInput: trip.destination_input,
      durationDays,
    },
    itinerary: {
      destination: trip.destination,
      durationDays,
      days,
    },
  };
}
