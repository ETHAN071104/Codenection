import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  hostOnlyResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { parseTripPlanningMode } from '@/lib/trips/setup-core';
import { planningLockResponse } from '@/lib/trips/finalization';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  const body = (await request.json().catch(() => null)) as {
    planningMode?: unknown;
  } | null;
  const planningMode = parseTripPlanningMode(body?.planningMode);
  if (!planningMode) {
    return Response.json(
      {
        error: {
          code: 'INVALID_PLANNING_MODE',
          message: 'Choose how this trip should be planned.',
        },
      },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const planningLock = await planningLockResponse(authenticated.supabase, id);
  if (planningLock) return planningLock;
  const { data: trip, error: tripError } = await authenticated.supabase
    .from('trips')
    .select('created_by, destination, setup_stage')
    .eq('id', id)
    .maybeSingle();
  if (tripError || !trip) return unavailableTripResponse();
  if (trip.created_by !== authenticated.user.id) return hostOnlyResponse();
  if (
    !trip.destination ||
    (trip.setup_stage !== 'mode' &&
      trip.setup_stage !== 'collaborative_ready' &&
      trip.setup_stage !== 'ai_ready')
  ) {
    return Response.json(
      {
        error: {
          code: 'DESTINATION_REQUIRED',
          message:
            'Choose a destination and travel range before selecting a planning style.',
        },
      },
      { status: 409 },
    );
  }

  const { data, error } = await authenticated.supabase
    .from('trips')
    .update({ planning_mode: planningMode, setup_stage: 'preparing' })
    .eq('id', id)
    .select('planning_mode, setup_stage')
    .maybeSingle();
  if (error || !data) return unavailableTripResponse();

  if (planningMode === 'collaborative') {
    const { error: roundError } = await authenticated.supabase.rpc(
      'start_place_selection_round',
      { p_trip_id: id },
    );
    if (roundError) {
      await authenticated.supabase
        .from('trips')
        .update({ planning_mode: null, setup_stage: 'mode' })
        .eq('id', id)
        .eq('created_by', authenticated.user.id);
      return Response.json(
        {
          error: {
            code: 'SELECTION_ROUND_UNAVAILABLE',
            message: 'We could not start the shared selection round.',
          },
        },
        { status: 500 },
      );
    }
  }

  return Response.json({
    planningMode: parseTripPlanningMode(data.planning_mode),
    setupStage: data.setup_stage,
  });
}
