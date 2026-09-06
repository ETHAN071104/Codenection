import type { Json } from '@/lib/supabase/database.types';
import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  hostOnlyResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { generateGroundedItinerary } from '@/lib/phase2/planning';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { INTERESTS, parseAverageInterests } from '@/lib/preferences/model';
import type { ExplorationPreference } from '@/lib/phase2/types';

function parseExplorationPreference(
  value: unknown,
): ExplorationPreference | null {
  return value === 'stay_local' ||
    value === 'nearby_day_trips' ||
    value === 'explore_freely'
    ? value
    : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const data = await loadItineraryPageData(
      authenticated.supabase,
      id,
      authenticated.user.id,
    );
    return data ? Response.json(data) : unavailableTripResponse();
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  const body = (await request.json().catch(() => null)) as {
    explorationPreference?: unknown;
  } | null;
  const explorationPreference = parseExplorationPreference(
    body?.explorationPreference,
  );
  if (!explorationPreference) {
    return Response.json(
      {
        error: {
          code: 'INVALID_EXPLORATION_PREFERENCE',
          message: 'Choose how broadly this trip should explore.',
        },
      },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const { data: trip, error: tripError } = await authenticated.supabase
    .from('trips')
    .select('id, created_by, destination')
    .eq('id', id)
    .maybeSingle();
  if (tripError || !trip) return unavailableTripResponse();
  if (trip.created_by !== authenticated.user.id) return hostOnlyResponse();
  if (!trip.destination) {
    return Response.json(
      {
        error: {
          code: 'DESTINATION_REQUIRED',
          message: 'Choose a destination before setting the trip scope.',
        },
      },
      { status: 409 },
    );
  }

  const { data, error } = await authenticated.supabase
    .from('trips')
    .update({
      exploration_preference: explorationPreference,
      geographic_scope: null,
      planning_mode: null,
      setup_stage: 'mode',
    })
    .eq('id', id)
    .select('id, destination, exploration_preference')
    .maybeSingle();
  if (error || !data) return unavailableTripResponse();
  return Response.json({
    explorationPreference: parseExplorationPreference(
      data.exploration_preference,
    ),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      explorationPreference?: unknown;
    };
    const { data: trip, error: tripError } = await authenticated.supabase
      .from('trips')
      .select(
        'id, created_by, destination, duration_days, exploration_preference',
      )
      .eq('id', id)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip) return unavailableTripResponse();
    if (trip.created_by !== authenticated.user.id) return hostOnlyResponse();
    if (!trip.destination) throw new Error('DESTINATION_REQUIRED');
    const explorationPreference =
      body.explorationPreference === undefined
        ? (parseExplorationPreference(trip.exploration_preference) ??
          'nearby_day_trips')
        : parseExplorationPreference(body.explorationPreference);
    if (!explorationPreference) {
      return Response.json(
        {
          error: {
            code: 'INVALID_EXPLORATION_PREFERENCE',
            message: 'Choose how broadly this itinerary should explore.',
          },
        },
        { status: 400 },
      );
    }

    const durationDays = trip.duration_days ?? 3;
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > 30
    ) {
      throw new Error('INVALID_TRIP_DURATION');
    }

    const { data: summaryRows, error: summaryError } =
      await authenticated.supabase.rpc('get_group_preference_summary', {
        p_trip_id: id,
      });
    if (summaryError) throw summaryError;
    const summary = summaryRows?.[0];
    const averageInterests = summary
      ? parseAverageInterests(summary.average_interests)
      : null;
    if (!summary || !averageInterests) {
      throw new Error('QUESTIONNAIRE_NOT_READY');
    }

    const topInterests = INTERESTS.map(({ key, label }) => ({
      key,
      label,
      rating: averageInterests[key],
    }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);
    const generated = await generateGroundedItinerary({
      destination: trip.destination,
      durationDays,
      explorationPreference,
      finiteBudgetAverage:
        summary.finite_budget_average === null
          ? null
          : Number(summary.finite_budget_average),
      unlimitedMembers: Number(summary.unlimited_members),
      averagePace: Number(summary.average_pace),
      topInterests,
    });

    const { data: saveRows, error: saveError } =
      await authenticated.supabase.rpc('replace_generated_itinerary', {
        p_trip_id: id,
        p_destination: trip.destination,
        p_places: generated.places as unknown as Json,
        p_items: generated.items as unknown as Json,
      });
    if (saveError) throw saveError;
    if (Number(saveRows?.[0]?.saved_items) !== generated.items.length) {
      throw new Error('ITINERARY_SAVE_FAILED');
    }

    const { error: scopeSaveError } = await authenticated.supabase
      .from('trips')
      .update({
        exploration_preference: explorationPreference,
        geographic_scope: generated.geographicScope as unknown as Json,
        planning_mode: 'ai',
        setup_stage: 'ai_ready',
      })
      .eq('id', id);
    if (scopeSaveError) throw scopeSaveError;

    const data = await loadItineraryPageData(
      authenticated.supabase,
      id,
      authenticated.user.id,
    );
    if (!data?.itinerary) throw new Error('ITINERARY_SAVE_FAILED');

    return Response.json({ ...data, metrics: generated.metrics });
  } catch (error) {
    const { id } = await context.params;
    await authenticated.supabase
      .from('trips')
      .update({ planning_mode: null, setup_stage: 'mode' })
      .eq('id', id)
      .eq('created_by', authenticated.user.id)
      .eq('setup_stage', 'preparing');
    return phase2ErrorResponse(error);
  }
}
