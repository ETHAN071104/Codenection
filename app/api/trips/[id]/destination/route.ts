import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  const body = (await request.json().catch(() => null)) as {
    destination?: unknown;
    destinationInput?: unknown;
  } | null;
  const destination =
    typeof body?.destination === 'string'
      ? body.destination.trim().replace(/\s+/g, ' ')
      : '';
  if (destination.length < 3 || destination.length > 120) {
    return Response.json(
      {
        error: {
          code: 'INVALID_DESTINATION',
          message: 'Choose a destination between 3 and 120 characters.',
        },
      },
      { status: 400 },
    );
  }
  const destinationInput =
    typeof body?.destinationInput === 'string'
      ? body.destinationInput.trim().replace(/\s+/g, ' ')
      : null;
  if (
    destinationInput !== null &&
    (destinationInput.length < 3 || destinationInput.length > 120)
  ) {
    return Response.json(
      {
        error: {
          code: 'INVALID_DESTINATION_INPUT',
          message: 'Enter a country, state, or city under 120 characters.',
        },
      },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const { data, error } = await authenticated.supabase
    .from('trips')
    .update({ destination, destination_input: destinationInput })
    .eq('id', id)
    .select('id, destination, destination_input')
    .maybeSingle();
  if (error || !data) return unavailableTripResponse();
  return Response.json({
    destination: data.destination,
    destinationInput: data.destination_input,
  });
}
