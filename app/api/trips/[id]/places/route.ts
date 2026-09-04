import type { Json } from '@/lib/supabase/database.types';
import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  unauthorizedResponse,
} from '@/lib/phase2/api-error';
import { getPlaceCandidateById } from '@/lib/phase2/google-places';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { finalizePlannerDay } from '@/lib/planner/server';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      day?: unknown;
      externalPlaceId?: unknown;
    } | null;
    const day = body?.day;
    const externalPlaceId =
      typeof body?.externalPlaceId === 'string'
        ? body.externalPlaceId.trim()
        : '';
    if (
      typeof day !== 'number' ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > 30 ||
      !externalPlaceId
    ) {
      return Response.json(
        {
          error: {
            code: 'INVALID_PLACE',
            message: 'Choose a valid place and itinerary day.',
          },
        },
        { status: 400 },
      );
    }

    const current = await loadItineraryPageData(authenticated.supabase, id);
    const alreadyAdded = current?.itinerary?.days
      .find((entry) => entry.day === day)
      ?.items.some(
        (item) => item.place.externalPlaceId === externalPlaceId,
      );
    if (alreadyAdded) {
      return Response.json(
        await finalizePlannerDay(authenticated.supabase, id, day),
      );
    }

    const place = await getPlaceCandidateById(externalPlaceId);
    const { data: rows, error } = await authenticated.supabase.rpc(
      'add_itinerary_place',
      {
        p_trip_id: id,
        p_day_number: day,
        p_place: place as unknown as Json,
        p_estimated_duration_minutes: 60,
      },
    );
    if (error || !rows?.[0]?.item_id) throw error ?? new Error('ADD_FAILED');

    return Response.json(
      await finalizePlannerDay(authenticated.supabase, id, day),
    );
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
