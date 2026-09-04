import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import { phase2ErrorResponse, unauthorizedResponse } from '@/lib/phase2/api-error';
import { loadItineraryPageData } from '@/lib/phase2/storage';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const body = (await request.json().catch(() => null)) as {
      day?: unknown;
      currentItemId?: unknown;
      type?: unknown;
      minutes?: unknown;
    } | null;
    const day = body?.day;
    if (
      !Number.isInteger(day) ||
      typeof day !== 'number' ||
      typeof body?.currentItemId !== 'string' ||
      (body?.type !== 'stay_longer' && body?.type !== 'running_late') ||
      ![15, 30, 60, 90].includes(Number(body?.minutes))
    ) {
      throw new Error('INVALID_SCHEDULE_ADJUSTMENT');
    }
    const { id } = await context.params;
    const { error } = await authenticated.supabase.rpc(
      'adjust_itinerary_schedule',
      {
        p_trip_id: id,
        p_day_number: day,
        p_current_item_id: body.currentItemId,
        p_change_type: body.type,
        p_minutes: Number(body.minutes),
      },
    );
    if (error) throw error;
    const data = await loadItineraryPageData(authenticated.supabase, id);
    if (!data?.itinerary) throw new Error('SCHEDULE_ADJUSTMENT_FAILED');
    return Response.json(data);
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
