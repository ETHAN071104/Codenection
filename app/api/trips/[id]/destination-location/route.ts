import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { resolveDestinationLocation } from '@/lib/phase2/google-places';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const body = (await request.json().catch(() => null)) as {
      query?: unknown;
    } | null;
    const query =
      typeof body?.query === 'string'
        ? body.query.trim().replace(/\s+/g, ' ')
        : '';
    if (query.length < 2 || query.length > 120) {
      return Response.json(
        {
          error: {
            code: 'INVALID_DESTINATION_INPUT',
            message: 'Enter a destination between 2 and 120 characters.',
          },
        },
        { status: 400 },
      );
    }

    const { id } = await context.params;
    const { data: trip, error } = await authenticated.supabase
      .from('trips')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!trip) return unavailableTripResponse();

    const location = await resolveDestinationLocation(query);
    return Response.json({ location });
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
