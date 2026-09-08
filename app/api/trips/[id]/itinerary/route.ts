import type { Json } from '@/lib/supabase/database.types';
import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  hostOnlyResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { parseAverageInterests } from '@/lib/preferences/model';
import type { ExplorationPreference } from '@/lib/phase2/types';
import { planningLockResponse } from '@/lib/trips/finalization';
import {
  loadGroundedCandidatePool,
  MINIMUM_GROUNDED_CANDIDATES,
} from '@/lib/malaysia-places/grounded-candidate-pool';
import {
  createAutomaticPlanningSelection,
  createServerPlanningIntelligencePlan,
  geographicScopeForPlanningPlan,
  persistPlanningIntelligencePlan,
} from '@/lib/malaysia-places/planning-orchestration';
import { parseTripEndpoint } from '@/lib/trips/travel-boundaries';
import { phase9ItineraryMatchesPersisted } from '@/lib/malaysia-places/itinerary-bridge-core';

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
  const planningLock = await planningLockResponse(authenticated.supabase, id);
  if (planningLock) return planningLock;
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
    const planningLock = await planningLockResponse(authenticated.supabase, id);
    if (planningLock) return planningLock;
    const body = (await request.json().catch(() => ({}))) as {
      explorationPreference?: unknown;
    };
    const { data: trip, error: tripError } = await authenticated.supabase
      .from('trips')
      .select(
        'id, created_by, destination, duration_days, start_date, exploration_preference, planning_mode, arrival_time, departure_time, arrival_point, departure_point',
      )
      .eq('id', id)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip) return unavailableTripResponse();
    if (trip.created_by !== authenticated.user.id) return hostOnlyResponse();
    const destination = trip.destination;
    if (!destination) throw new Error('DESTINATION_REQUIRED');
    if (trip.planning_mode !== 'ai') {
      throw new Error('AI_PLANNING_MODE_REQUIRED');
    }
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

    const travelDna = {
      finite_budget_average:
        summary.finite_budget_average === null
          ? null
          : Number(summary.finite_budget_average),
      unlimited_members: Number(summary.unlimited_members),
      average_pace: Number(summary.average_pace),
      average_interests: averageInterests,
    };
    const { candidates, candidateSource, googlePlacesCalls } =
      await loadGroundedCandidatePool(authenticated.supabase, {
        destination,
        travelDna,
      });
    if (candidates.length < MINIMUM_GROUNDED_CANDIDATES) {
      throw new Error('NO_PLACE_CANDIDATES');
    }

    const arrivalTime = trip.arrival_time?.slice(0, 5) ?? null;
    const departureTime = trip.departure_time?.slice(0, 5) ?? null;
    const { candidatePool, selected } = createAutomaticPlanningSelection(
      candidates,
      {
        averagePace: travelDna.average_pace,
        durationDays,
        arrivalTime,
        departureTime,
      },
    );
    if (!selected.length) throw new Error('NO_PLACE_CANDIDATES');

    const plan = await createServerPlanningIntelligencePlan({
      destination,
      durationDays,
      candidates: candidatePool,
      selected,
      constraints: {
        arrivalTime,
        departureTime,
        arrivalPoint: parseTripEndpoint(trip.arrival_point),
        departurePoint: parseTripEndpoint(trip.departure_point),
        averagePace: travelDna.average_pace,
        startDate: trip.start_date,
      },
      validateRoutes: true,
    });
    const desiredItinerary = plan.desiredItinerary;
    if (plan.finalValidation.status === 'FAIL' || !desiredItinerary) {
      throw new Error('FINAL_ITINERARY_INFEASIBLE');
    }

    const current = await loadItineraryPageData(
      authenticated.supabase,
      id,
      authenticated.user.id,
    );
    const unchanged = phase9ItineraryMatchesPersisted(
      desiredItinerary,
      current?.itinerary ?? null,
    );
    if (!unchanged) {
      const persistence = await persistPlanningIntelligencePlan(plan, () =>
        authenticated.supabase.rpc('replace_generated_itinerary', {
          p_trip_id: id,
          p_destination: destination,
          p_places: desiredItinerary.places as unknown as Json,
          p_items: desiredItinerary.items as unknown as Json,
        }),
      );
      if (!persistence.persisted) {
        throw new Error('FINAL_ITINERARY_INFEASIBLE');
      }
      const { data: saveRows, error: saveError } = persistence.value;
      if (saveError) throw saveError;
      if (
        Number(saveRows?.[0]?.saved_items) !== desiredItinerary.items.length
      ) {
        throw new Error('ITINERARY_SAVE_FAILED');
      }
    }

    const geographicScope = geographicScopeForPlanningPlan(destination, plan);

    const { error: scopeSaveError } = await authenticated.supabase
      .from('trips')
      .update({
        exploration_preference: explorationPreference,
        geographic_scope: geographicScope as unknown as Json,
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
    if (
      !data?.itinerary ||
      !phase9ItineraryMatchesPersisted(desiredItinerary, data.itinerary)
    ) {
      throw new Error('ITINERARY_SAVE_FAILED');
    }

    return Response.json({
      ...data,
      metrics: {
        openRouterCalls: 0,
        googlePlacesCalls,
        candidateSource,
        candidateCount: candidatePool.length,
        selectedPlaceCount: selected.length,
        persistedPlaceCount: desiredItinerary.places.length,
        overflowPlaceCount: plan.finalValidation.overflowCount,
        orsCalls: plan.draftSchedule.routeValidation?.orsCalls ?? 0,
        persistenceOutcome: unchanged ? 'unchanged' : 'replaced',
      },
    });
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
