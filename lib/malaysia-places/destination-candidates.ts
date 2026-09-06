import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { deriveMalaysiaPlaceArea } from '@/lib/malaysia-places/area';
import { searchPlannerPlaces } from '@/lib/phase2/google-places-core';
import type {
  GoogleAddressComponent,
  PlaceCandidate,
} from '@/lib/phase2/types';
import type { Database } from '@/lib/supabase/database.types';

const PRIMARY_SEARCHES = [
  'top attractions and landmarks',
  'museums culture and heritage',
  'parks nature and family attractions',
  'food markets and shopping',
] as const;
const ALTERNATE_SEARCH = 'best things to do';
const MINIMUM_USEFUL_POOL = 12;
const MAXIMUM_POOL = 30;

const GENERIC_TYPES = new Set([
  'establishment',
  'point_of_interest',
  'tourist_attraction',
]);

export function destinationCandidatePoolKey(destination: string) {
  if (/kuala\s*lumpur|\bkl\b/i.test(destination)) return 'Kuala Lumpur';
  return destination.trim().replace(/\s+/g, ' ');
}

function normalized(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function componentValue(components: GoogleAddressComponent[], type: string) {
  const component = components.find((candidate) =>
    candidate.types?.includes(type),
  );
  return component?.longText?.trim() || null;
}

function belongsToDestination(place: PlaceCandidate, destination: string) {
  const destinationText = normalized(destination);
  const primaryName = normalized(destination.split(',')[0] ?? destination);
  const addressText = normalized(
    [place.name, place.address, place.sourceArea].filter(Boolean).join(' '),
  );
  if (!addressText) return false;
  if (primaryName && addressText.includes(primaryName)) return true;

  const meaningfulTokens = destinationText
    .split(' ')
    .filter(
      (token) =>
        token.length >= 4 &&
        token !== 'malaysia' &&
        token !== 'state' &&
        token !== 'region',
    );
  return meaningfulTokens.some((token) => addressText.includes(token));
}

function primaryType(types: string[]) {
  return types.find((type) => !GENERIC_TYPES.has(type)) ?? types[0] ?? null;
}

function rowForPlace(
  place: PlaceCandidate,
  destination: string,
  poolKey: string,
) {
  const components = place.addressComponents ?? [];
  const country = componentValue(components, 'country');
  if (!country || !belongsToDestination(place, destination)) return null;

  return {
    google_place_id: place.externalPlaceId,
    name: place.name,
    country,
    state: componentValue(components, 'administrative_area_level_1'),
    city: poolKey,
    area: deriveMalaysiaPlaceArea(components, place.address, poolKey),
    latitude: place.latitude,
    longitude: place.longitude,
    category: primaryType(place.types),
    subcategories: place.types,
    estimated_duration_minutes: null,
    indoor_outdoor: null,
    best_time_of_day: null,
    culture_score: null,
    food_score: null,
    nature_score: null,
    shopping_score: null,
    adventure_score: null,
    nightlife_score: null,
    photography_score: null,
    budget_score: null,
    google_rating: place.rating,
    google_rating_count: place.ratingCount,
    price_level: place.priceLevel,
    source: 'google_places',
    last_verified_at: new Date().toISOString(),
  };
}

function serviceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Candidate preparation is not configured on the server.');
  }
  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export async function importDestinationCandidates(destination: string) {
  const poolKey = destinationCandidatePoolKey(destination);
  const primaryResults = (
    await Promise.all(
      PRIMARY_SEARCHES.map((query) =>
        searchPlannerPlaces(query, destination, 8),
      ),
    )
  ).flat();
  let googlePlacesCalls = PRIMARY_SEARCHES.length;
  let candidates = Array.from(
    new Map(
      primaryResults.map((place) => [place.externalPlaceId, place]),
    ).values(),
  ).filter((place) => belongsToDestination(place, destination));

  if (candidates.length < MINIMUM_USEFUL_POOL) {
    const alternate = await searchPlannerPlaces(
      ALTERNATE_SEARCH,
      destination,
      8,
    );
    googlePlacesCalls += 1;
    candidates = Array.from(
      new Map(
        [...candidates, ...alternate].map((place) => [
          place.externalPlaceId,
          place,
        ]),
      ).values(),
    ).filter((place) => belongsToDestination(place, destination));
  }

  const rows = candidates
    .slice(0, MAXIMUM_POOL)
    .map((place) => rowForPlace(place, destination, poolKey))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (rows.length === 0) {
    return { poolKey, imported: 0, googlePlacesCalls };
  }

  const { data, error } = await serviceClient()
    .from('malaysia_places')
    .upsert(rows, { onConflict: 'google_place_id' })
    .select('google_place_id');
  if (error) throw error;

  return {
    poolKey,
    imported: data?.length ?? 0,
    googlePlacesCalls,
  };
}
