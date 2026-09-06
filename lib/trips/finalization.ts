import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export function finalizedPlanningResponse() {
  return Response.json(
    {
      error: {
        code: 'TRIP_FINALIZED',
        message:
          'This trip is already planned. Open the current map or Live Trip instead.',
      },
    },
    { status: 409 },
  );
}

export async function planningLockResponse(
  supabase: SupabaseClient<Database>,
  tripId: string,
) {
  const { data, error } = await supabase
    .from('trips')
    .select('finalized_at')
    .eq('id', tripId)
    .maybeSingle();
  if (error) throw error;
  return data?.finalized_at ? finalizedPlanningResponse() : null;
}
