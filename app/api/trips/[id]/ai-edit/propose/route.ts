import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { proposeItineraryEdit } from '@/lib/planner/ai-edit';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      request?: unknown;
      day?: unknown;
    } | null;
    const editRequest =
      typeof body?.request === 'string' ? body.request.trim() : '';
    const day = body?.day;
    if (
      editRequest.length < 3 ||
      editRequest.length > 400 ||
      typeof day !== 'number' ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > 30
    ) {
      return Response.json(
        {
          error: {
            code: 'INVALID_EDIT_REQUEST',
            message: 'Describe one clear change for this itinerary day.',
          },
        },
        { status: 400 },
      );
    }

    const data = await loadItineraryPageData(authenticated.supabase, id);
    if (!data?.itinerary) return unavailableTripResponse();
    return Response.json(
      await proposeItineraryEdit({ request: editRequest, day, data }),
    );
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
