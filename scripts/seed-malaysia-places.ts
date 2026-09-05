import { createClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';

import type { Database } from '../lib/supabase/database.types';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const { importMalaysiaPlaces } = await import('../lib/malaysia-places/importer-core');

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY;

if (!url) throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
if (!googlePlacesKey) throw new Error('Missing GOOGLE_PLACES_API_KEY.');

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const queries = [
  'landmarks',
  'museums and culture',
  'food markets',
  'parks and nature',
  'shopping malls',
  'family attractions',
];

const result = await importMalaysiaPlaces(supabase, 'Kuala Lumpur', queries);
const { count, error } = await supabase
  .from('malaysia_places')
  .select('id', { count: 'exact', head: true })
  .eq('country', 'Malaysia')
  .eq('city', 'Kuala Lumpur');

if (error) throw error;
console.log(JSON.stringify({ upserted: result.imported, uniqueKlRecords: count ?? 0 }));
