import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const appUrl = process.env.PHASE2_APP_URL ?? 'http://localhost:3000';

if (!url || !publishableKey) {
  throw new Error('Supabase environment is missing.');
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION_FAILED: ${message}`);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
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
    throw new Error(
      `${payload?.error?.code ?? response.status}: ${payload?.error?.message ?? 'Request failed'}`,
    );
  }
  return payload;
}

async function createReadyTrip(client, name) {
  const created = await client.rpc('create_trip', {
    p_display_name: name,
    p_duration_days: 3,
  });
  if (created.error) throw created.error;
  const tripId = created.data?.[0]?.trip_id;
  assert(Boolean(tripId), 'trip should be created');

  const profile = await client.rpc('save_preference_profile', {
    p_trip_id: tripId,
    p_personal_budget: 1800,
    p_budget_unlimited: false,
    p_travel_pace: 3,
    p_interests: {
      food_dining: 5,
      history_heritage: 5,
      nature_viewpoints: 4,
      instagrammable_cafes: 3,
    },
  });
  if (profile.error) throw profile.error;
  return tripId;
}

const client = createClient(url, publishableKey, {
  auth: {
    storage: memoryStorage(),
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const testTripIds = [];

try {
  const signIn = await client.auth.signInAnonymously();
  if (signIn.error || !signIn.data.session) {
    throw signIn.error ?? new Error('Anonymous sign-in failed.');
  }
  const token = signIn.data.session.access_token;

  const japanTripId = await createReadyTrip(client, 'Japan flow check');
  testTripIds.push(japanTripId);
  const japanResolution = await api(
    `/api/trips/${japanTripId}/destination-suggestion`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationInput: 'Japan',
        previousSuggestions: [],
      }),
    },
  );
  assert(
    japanResolution.metrics?.openRouterCalls === 1,
    'broad-area resolution should use one OpenRouter call',
  );
  assert(
    japanResolution.suggestion?.inputWasSpecific === false,
    'Japan should be recognized as a broad geographic area',
  );
  assert(
    japanResolution.suggestion.destination.toLowerCase().includes('japan'),
    'the resolved destination should remain inside Japan',
  );

  const accepted = await api(`/api/trips/${japanTripId}/destination`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: japanResolution.suggestion.destination,
      destinationInput: 'Japan',
    }),
  });
  assert(
    accepted.destinationInput === 'Japan',
    'the entered scope should persist',
  );
  assert(
    accepted.destination === japanResolution.suggestion.destination,
    'the resolved destination should persist',
  );

  const itinerary = await api(`/api/trips/${japanTripId}/itinerary`, token, {
    method: 'POST',
  });
  const itineraryItems = itinerary.itinerary.days.flatMap((day) => day.items);
  assert(
    itinerary.itinerary.days.length === 3,
    'grounded itinerary should have three days',
  );
  assert(
    itineraryItems.every((item) => Boolean(item.place.externalPlaceId)),
    'every itinerary stop should retain a Google Place ID',
  );

  const surpriseTripId = await createReadyTrip(client, 'Surprise flow check');
  testTripIds.push(surpriseTripId);
  const suggestionA = await api(
    `/api/trips/${surpriseTripId}/destination-suggestion`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationInput: null, previousSuggestions: [] }),
    },
  );
  const suggestionB = await api(
    `/api/trips/${surpriseTripId}/destination-suggestion`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationInput: null,
        previousSuggestions: [suggestionA.suggestion.destination],
      }),
    },
  );
  assert(
    suggestionA.metrics?.openRouterCalls === 1 &&
      suggestionB.metrics?.openRouterCalls === 1,
    'each explicit suggestion click should use exactly one OpenRouter call',
  );
  assert(
    suggestionA.suggestion.destination.toLowerCase() !==
      suggestionB.suggestion.destination.toLowerCase(),
    'Suggest another should return a different destination',
  );

  console.log(
    JSON.stringify(
      {
        countryInput: 'Japan',
        resolvedDestination: japanResolution.suggestion.destination,
        destinationInputPersisted: accepted.destinationInput,
        groundedStops: itineraryItems.length,
        itineraryOpenRouterCalls: itinerary.metrics.openRouterCalls,
        googlePlacesCalls: itinerary.metrics.googlePlacesCalls,
        suggestionA: suggestionA.suggestion.destination,
        suggestionB: suggestionB.suggestion.destination,
        suggestionCallsPerClick: [
          suggestionA.metrics.openRouterCalls,
          suggestionB.metrics.openRouterCalls,
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const tripId of testTripIds) {
    const cleanup = await client.from('trips').delete().eq('id', tripId);
    if (cleanup.error) console.error('Cleanup failed for trip:', tripId);
  }
  await client.auth.signOut();
}
