import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../lib/supabase/database.types';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY;
if (!url) throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
if (!googlePlacesKey) throw new Error('Missing GOOGLE_PLACES_API_KEY.');

const { getPlaceAddressDetails } = await import('../lib/phase2/google-places-core');
const { deriveMalaysiaPlaceArea } = await import('../lib/malaysia-places/area');
const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: allRecords, error: allError } = await supabase
  .from('malaysia_places')
  .select('id,name,google_place_id,area')
  .eq('country', 'Malaysia')
  .eq('city', 'Kuala Lumpur');
if (allError) throw allError;

const unresolved = (allRecords ?? []).filter((record) => !record.area && record.google_place_id);
const mappings: Array<{ name: string; area: string }> = [];
let googlePlaceCalls = 0;

for (const record of unresolved) {
  googlePlaceCalls += 1;
  const details = await getPlaceAddressDetails(record.google_place_id!);
  const area = deriveMalaysiaPlaceArea(details.addressComponents, details.formattedAddress);
  if (!area) continue;
  const { error } = await supabase
    .from('malaysia_places')
    .update({ area, last_verified_at: new Date().toISOString() })
    .eq('id', record.id)
    .is('area', null);
  if (error) throw error;
  mappings.push({ name: record.name, area });
}

const { data: finalRecords, error: finalError } = await supabase
  .from('malaysia_places')
  .select('name,area')
  .eq('country', 'Malaysia')
  .eq('city', 'Kuala Lumpur')
  .order('name');
if (finalError) throw finalError;

const recordsWithArea = (finalRecords ?? []).filter((record) => record.area);
console.log(JSON.stringify({
  totalKlRecords: finalRecords?.length ?? 0,
  recordsWithArea: recordsWithArea.length,
  recordsStillMissingArea: (finalRecords?.length ?? 0) - recordsWithArea.length,
  uniqueAreas: [...new Set(recordsWithArea.map((record) => record.area!))].sort(),
  updatedMappings: mappings,
  sampleMappings: recordsWithArea.slice(0, 10),
  googlePlaceCalls,
}));
