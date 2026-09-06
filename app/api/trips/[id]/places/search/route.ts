import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { searchPlannerPlaces } from '@/lib/phase2/google-places';
import { planningLockResponse } from '@/lib/trips/finalization';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const planningLock = await planningLockResponse(authenticated.supabase, id);
    if (planningLock) return planningLock;
    const body = (await request.json().catch(() => null)) as {
      query?: unknown;
    } | null;
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (query.length < 2 || query.length > 120) {
      return Response.json(
        {
          error: {
            code: 'INVALID_PLACE_QUERY',
            message: 'Enter a short place or activity to search for.',
          },
        },
        { status: 400 },
      );
    }

    const { data: trip, error } = await authenticated.supabase
      .from('trips')
      .select('destination')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!trip?.destination) return unavailableTripResponse();

    const results = await searchPlannerPlaces(query, trip.destination, 5);
    return Response.json({ results: results.slice(0, 5) });
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
