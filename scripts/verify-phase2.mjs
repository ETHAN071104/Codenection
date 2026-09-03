import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const appUrl = process.env.PHASE2_APP_URL ?? 'http://localhost:3000';

if (!url || !publishableKey) {
  throw new Error('Supabase environment is missing.');
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION_FAILED: ${message}`);
}

async function api(path, token, init) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? 'Unknown API error';
    throw new Error(`${code}: ${message}`);
  }
  return payload;
}

const client = createClient(url, publishableKey, {
  auth: {
    storage: memoryStorage(),
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

let tripId;
let deleted = false;

try {
  const signIn = await client.auth.signInAnonymously();
  if (signIn.error || !signIn.data.session) {
    throw signIn.error ?? new Error('Anonymous sign-in failed.');
  }
  const token = signIn.data.session.access_token;

  const created = await client.rpc('create_trip', {
    p_display_name: 'Phase 2 verifier',
    p_destination: 'Penang, Malaysia',
    p_duration_days: 3,
  });
  if (created.error) throw created.error;
  tripId = created.data?.[0]?.trip_id;
  assert(Boolean(tripId), 'the verification trip should be created');

  const savedProfile = await client.rpc('save_preference_profile', {
    p_trip_id: tripId,
    p_personal_budget: 1200,
    p_budget_unlimited: false,
    p_travel_pace: 3,
    p_interests: {
      food_dining: 5,
      history_heritage: 5,
      nature_viewpoints: 4,
      instagrammable_cafes: 3,
    },
  });
  if (savedProfile.error) throw savedProfile.error;

  const generated = await api(`/api/trips/${tripId}/itinerary`, token, {
    method: 'POST',
  });
  assert(
    generated.metrics?.openRouterCalls === 2,
    'known destination should use two OpenRouter calls',
  );
  assert(
    generated.metrics?.googlePlacesCalls >= 1 &&
      generated.metrics.googlePlacesCalls <= 4,
    'Google Places calls should stay between one and four',
  );
  assert(
    generated.itinerary?.days?.length === 3,
    'the itinerary should contain exactly three days',
  );

  const generatedItems = generated.itinerary.days.flatMap((day) => day.items);
  assert(
    generatedItems.length > 0,
    'the generated itinerary should contain stops',
  );
  assert(
    generatedItems.every((item) => Boolean(item.place?.externalPlaceId)),
    'every itinerary stop should have an external Google Place ID',
  );

  const placesQuery = await client
    .from('places')
    .select(
      'id, external_place_id, name, formatted_address, latitude, longitude, rating, rating_count, price_level, types, metadata',
    )
    .eq('trip_id', tripId);
  if (placesQuery.error) throw placesQuery.error;
  const persistedPlaces = placesQuery.data ?? [];
  assert(
    persistedPlaces.length === generated.metrics.persistedPlaceCount,
    'persisted place count should match the grounded generation result',
  );
  assert(
    persistedPlaces.every(
      (place) =>
        Boolean(place.external_place_id) &&
        Number.isFinite(Number(place.latitude)) &&
        Number.isFinite(Number(place.longitude)) &&
        place.metadata?.generationSource === 'phase2',
    ),
    'persisted places should carry real external IDs, coordinates, and Phase 2 provenance',
  );

  const itemsQuery = await client
    .from('itinerary_items')
    .select('id, place_id, day_number, sort_order, generation_source')
    .eq('trip_id', tripId)
    .eq('generation_source', 'phase2');
  if (itemsQuery.error) throw itemsQuery.error;
  const persistedItems = itemsQuery.data ?? [];
  const persistedPlaceIds = new Set(persistedPlaces.map((place) => place.id));
  assert(
    persistedItems.length === generatedItems.length,
    'all generated stops should be persisted',
  );
  assert(
    persistedItems.every(
      (item) => item.place_id && persistedPlaceIds.has(item.place_id),
    ),
    'every saved stop should reference a Google-validated persisted place',
  );

  const knownPlace = persistedPlaces[0];
  const unknownProbe = await client.rpc('replace_generated_itinerary', {
    p_trip_id: tripId,
    p_destination: 'Penang, Malaysia',
    p_places: [
      {
        externalPlaceId: knownPlace.external_place_id,
        name: knownPlace.name,
        address: knownPlace.formatted_address,
        latitude: Number(knownPlace.latitude),
        longitude: Number(knownPlace.longitude),
        rating: knownPlace.rating === null ? null : Number(knownPlace.rating),
        ratingCount: knownPlace.rating_count,
        priceLevel: knownPlace.price_level,
        types: knownPlace.types,
      },
    ],
    p_items: [
      {
        externalPlaceId: 'ai-invented-place-id',
        day: 1,
        sortOrder: 0,
        plannedTime: '09:00',
        estimatedCost: null,
        estimatedDurationMinutes: 60,
        reason: 'Grounding rejection probe.',
        dayTheme: 'Probe',
      },
    ],
  });
  assert(
    Boolean(unknownProbe.error?.message?.includes('UNKNOWN_PLACE_ID')),
    'the persistence boundary should reject an unknown AI-generated place ID',
  );

  const firstReload = await api(`/api/trips/${tripId}/itinerary`, token);
  const secondReload = await api(`/api/trips/${tripId}/itinerary`, token);
  assert(
    !('metrics' in firstReload),
    'loading a saved itinerary should not report provider calls',
  );
  assert(
    JSON.stringify(firstReload.itinerary) ===
      JSON.stringify(secondReload.itinerary),
    'refreshing should return the unchanged persisted itinerary',
  );

  const removed = await client.from('trips').delete().eq('id', tripId);
  if (removed.error) throw removed.error;
  deleted = true;

  console.log(
    JSON.stringify(
      {
        scenario: '3D2N Penang with completed preferences',
        days: generated.itinerary.days.length,
        stops: generatedItems.length,
        externalPlaceIds: persistedPlaces.length,
        providerCalls: generated.metrics,
        unknownPlaceIdRejected: true,
        refreshRegenerated: false,
        cleanup: 'test trip deleted',
      },
      null,
      2,
    ),
  );
} finally {
  if (tripId && !deleted) {
    const cleanup = await client.from('trips').delete().eq('id', tripId);
    if (cleanup.error) {
      console.error('Verification cleanup failed; remove trip:', tripId);
    }
  }
  await client.auth.signOut();
}
