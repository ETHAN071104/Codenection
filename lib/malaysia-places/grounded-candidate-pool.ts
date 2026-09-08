import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GroupPreferenceSummary } from '@/lib/preferences/model';
import type { Database } from '@/lib/supabase/database.types';
import { getCandidatePlaces } from './candidates';
import {
  destinationCandidatePoolKey,
  importDestinationCandidates,
} from './destination-candidates';

export const MINIMUM_GROUNDED_CANDIDATES = 8;
const MINIMUM_CATALOG_COVERAGE = 12;

export async function loadGroundedCandidatePool(
  supabase: SupabaseClient<Database>,
  input: {
    destination: string;
    travelDna: GroupPreferenceSummary;
  },
) {
  const poolKey = destinationCandidatePoolKey(input.destination);
  let candidates = await getCandidatePlaces(supabase, {
    city: poolKey,
    travelDna: input.travelDna,
    limit: 30,
  });
  let candidateSource = 'existing_catalog' as
    | 'existing_catalog'
    | 'google_places';
  let googlePlacesCalls = 0;

  if (candidates.length < MINIMUM_CATALOG_COVERAGE) {
    const prepared = await importDestinationCandidates(input.destination);
    candidateSource = 'google_places';
    googlePlacesCalls = prepared.googlePlacesCalls;
    candidates = await getCandidatePlaces(supabase, {
      city: prepared.poolKey,
      travelDna: input.travelDna,
      limit: 30,
    });
  }

  return { candidates, candidateSource, googlePlacesCalls };
}
