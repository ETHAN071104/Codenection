import type { SupabaseClient } from '@supabase/supabase-js';
import { searchPlannerPlaces } from '@/lib/phase2/google-places-core';
import type { Database } from '@/lib/supabase/database.types';
import { deriveMalaysiaPlaceArea } from './area';

const SUPPORTED_CITIES = new Set(['Kuala Lumpur', 'Penang', 'Melaka']);

export async function importMalaysiaPlaces(client: SupabaseClient<Database>, city: 'Kuala Lumpur' | 'Penang' | 'Melaka', queries: string[]) {
  if (!SUPPORTED_CITIES.has(city)) throw new Error('UNSUPPORTED_MALAYSIA_CITY');
  const candidates = (await Promise.all(queries.slice(0, 6).map((query) => searchPlannerPlaces(query, `${city}, Malaysia`, 5)))).flat();
  const rows = Array.from(new Map(candidates.map((place) => [place.externalPlaceId, ({ google_place_id: place.externalPlaceId, name: place.name, country: 'Malaysia', city, area: city === 'Kuala Lumpur' ? deriveMalaysiaPlaceArea(place.addressComponents ?? [], place.address) : null, latitude: place.latitude, longitude: place.longitude, category: place.types[0] ?? null, subcategories: place.types, google_rating: place.rating, google_rating_count: place.ratingCount, price_level: place.priceLevel, source: 'google_places', last_verified_at: new Date().toISOString() })])).values());
  if (!rows.length) return { imported: 0 };
  const table = client.from('malaysia_places' as never) as unknown as { upsert: (values: typeof rows, options: { onConflict: string }) => Promise<{ error: { message: string } | null }> };
  const { error } = await table.upsert(rows, { onConflict: 'google_place_id' });
  if (error) throw error;
  return { imported: rows.length };
}
