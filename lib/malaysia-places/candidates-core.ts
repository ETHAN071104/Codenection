import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/database.types';
import { scoreMalaysiaPlace } from './recommendation';
import type { CandidatePlace, CandidateQuery, MalaysiaPlace } from './types';

function mapPlace(row: Record<string, unknown>): MalaysiaPlace {
  return {
    id: String(row.id), googlePlaceId: typeof row.google_place_id === 'string' ? row.google_place_id : null,
    name: String(row.name), country: String(row.country), state: typeof row.state === 'string' ? row.state : null,
    city: typeof row.city === 'string' ? row.city : null, area: typeof row.area === 'string' ? row.area : null,
    latitude: typeof row.latitude === 'number' ? row.latitude : null, longitude: typeof row.longitude === 'number' ? row.longitude : null,
    category: typeof row.category === 'string' ? row.category : null, subcategories: Array.isArray(row.subcategories) ? row.subcategories.filter((value): value is string => typeof value === 'string') : [],
    estimatedDurationMinutes: typeof row.estimated_duration_minutes === 'number' ? row.estimated_duration_minutes : null,
    indoorOutdoor: row.indoor_outdoor === 'indoor' || row.indoor_outdoor === 'outdoor' || row.indoor_outdoor === 'mixed' ? row.indoor_outdoor : null,
    bestTimeOfDay: typeof row.best_time_of_day === 'string' ? row.best_time_of_day : null,
    cultureScore: typeof row.culture_score === 'number' ? row.culture_score : null, foodScore: typeof row.food_score === 'number' ? row.food_score : null,
    natureScore: typeof row.nature_score === 'number' ? row.nature_score : null, shoppingScore: typeof row.shopping_score === 'number' ? row.shopping_score : null,
    adventureScore: typeof row.adventure_score === 'number' ? row.adventure_score : null, nightlifeScore: typeof row.nightlife_score === 'number' ? row.nightlife_score : null,
    photographyScore: typeof row.photography_score === 'number' ? row.photography_score : null, budgetScore: typeof row.budget_score === 'number' ? row.budget_score : null,
    googleRating: typeof row.google_rating === 'number' ? row.google_rating : null, googleRatingCount: typeof row.google_rating_count === 'number' ? row.google_rating_count : null,
    priceLevel: typeof row.price_level === 'string' ? row.price_level : null, source: String(row.source), lastVerifiedAt: typeof row.last_verified_at === 'string' ? row.last_verified_at : null,
  };
}

export async function getCandidatePlaces(client: SupabaseClient<Database>, query: CandidateQuery): Promise<CandidatePlace[]> {
  let request = client.from('malaysia_places').select('*').ilike('city', query.city).limit(Math.min(query.limit ?? 24, 50));
  if (query.area) request = request.ilike('area', query.area);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? [])
    .map((row) => mapPlace(row as Record<string, unknown>))
    .map((place) => ({ ...place, ...scoreMalaysiaPlace(place, query.travelDna) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
