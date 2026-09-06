import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  hostOnlyResponse,
  phase2ErrorResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { searchPlannerPlaces } from '@/lib/phase2/google-places';
import { planningLockResponse } from '@/lib/trips/finalization';

const ENDPOINT_TYPES = new Set([
  'airport',
  'bus_station',
  'ferry_terminal',
  'train_station',
  'transit_station',
]);

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
            code: 'INVALID_ENDPOINT_QUERY',
            message: 'Enter an airport or transport arrival point.',
          },
        },
        { status: 400 },
      );
    }

    const { data: trip, error } = await authenticated.supabase
      .from('trips')
      .select('created_by, destination')
      .eq('id', id)
      .maybeSingle();
    if (error || !trip) return unavailableTripResponse();
    if (trip.created_by !== authenticated.user.id) return hostOnlyResponse();
    if (!trip.destination) return unavailableTripResponse();

    const results = await searchPlannerPlaces(
      `${query} airport or transport terminal`,
      trip.destination,
      8,
    );
    return Response.json({
      results: results
        .filter((place) => place.types.some((type) => ENDPOINT_TYPES.has(type)))
        .slice(0, 5),
    });
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
