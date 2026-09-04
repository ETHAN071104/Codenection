import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import { unauthorizedResponse } from '@/lib/phase2/api-error';
import { finalizePlannerDay } from '@/lib/planner/server';

function invalidReorderResponse() {
  return Response.json(
    {
      error: {
        code: 'INVALID_REORDER',
        message: 'We could not save that itinerary order. Please try again.',
      },
    },
    { status: 400 },
  );
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  const body = (await request.json().catch(() => null)) as {
    day?: unknown;
    itemIds?: unknown;
  } | null;
  const day = body?.day;
  const itemIds = body?.itemIds;
  if (
    !Number.isInteger(day) ||
    typeof day !== 'number' ||
    day < 1 ||
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    itemIds.some((itemId) => typeof itemId !== 'string')
  ) {
    return invalidReorderResponse();
  }

  try {
    const { id } = await context.params;
    const { data, error } = await authenticated.supabase.rpc(
      'reorder_itinerary_day',
      {
        p_trip_id: id,
        p_day_number: day,
        p_item_ids: itemIds,
      },
    );
    if (error || !data || data.length !== itemIds.length) {
      return invalidReorderResponse();
    }

    const result = await finalizePlannerDay(
      authenticated.supabase,
      id,
      day,
    );
    return Response.json(result);
  } catch {
    return invalidReorderResponse();
  }
}
