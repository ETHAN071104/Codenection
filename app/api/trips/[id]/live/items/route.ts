import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  unauthorizedResponse,
} from '@/lib/phase2/api-error';
import { finalizePlannerDay } from '@/lib/planner/server';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      itemId?: unknown;
    } | null;
    const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
    if (!itemId) throw new Error('INVALID_ITEM');

    const { data: rows, error } = await authenticated.supabase.rpc(
      'remove_live_itinerary_item',
      { p_trip_id: id, p_item_id: itemId },
    );
    const day = rows?.[0]?.day_number;
    if (error || !day) throw error ?? new Error('REMOVE_FAILED');

    return Response.json(
      await finalizePlannerDay(authenticated.supabase, id, day, {
        allowFinalizedMutation: true,
      }),
    );
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
