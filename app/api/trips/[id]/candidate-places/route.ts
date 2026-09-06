import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/lib/supabase/database.types';
import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import { getCandidatePlaces } from '@/lib/malaysia-places/candidates';
import {
  destinationCandidatePoolKey,
  importDestinationCandidates,
} from '@/lib/malaysia-places/destination-candidates';
import {
  groupScore,
  rankCandidates,
} from '@/lib/malaysia-places/group-ranking';
import { getStayAreaRecommendation } from '@/lib/malaysia-places/stay-area';
import { clusterSelectedPlacesByDay } from '@/lib/malaysia-places/day-clustering';
import { createDeterministicDraftSchedule } from '@/lib/malaysia-places/deterministic-scheduling';
import {
  createScheduleFingerprint,
  normalizePhase9Itinerary,
  phase9ItineraryMatchesPersisted,
  Phase9ItineraryBridgeError,
} from '@/lib/malaysia-places/itinerary-bridge-core';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { Phase2ProviderError } from '@/lib/phase2/provider-error';
import { parseAverageInterests } from '@/lib/preferences/model';

function unavailable(
  message: string,
  status = 400,
  code = 'CANDIDATE_PLACES_UNAVAILABLE',
  details?: Record<string, unknown>,
) {
  return Response.json({ error: { code, message, ...details } }, { status });
}

async function loadPhase9Plan(
  supabase: SupabaseClient<Database>,
  userId: string,
  tripId: string,
) {
  const [
    tripResult,
    membershipResult,
    summaryResult,
    membersResult,
    votesResult,
  ] = await Promise.all([
    supabase
      .from('trips')
      .select(
        'destination, duration_days, exploration_preference, geographic_scope',
      )
      .eq('id', tripId)
      .maybeSingle(),
    supabase
      .from('trip_members')
      .select('id')
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.rpc('get_group_preference_summary', { p_trip_id: tripId }),
    supabase
      .from('trip_members')
      .select('id', { count: 'exact' })
      .eq('trip_id', tripId),
    supabase
      .from('trip_place_votes')
      .select('place_id, user_id, selected')
      .eq('trip_id', tripId)
      .eq('selected', true),
  ]);
  const error =
    tripResult.error ??
    membershipResult.error ??
    summaryResult.error ??
    membersResult.error ??
    votesResult.error;
  if (error) throw error;
  if (!tripResult.data || !membershipResult.data) return null;

  const destination = tripResult.data.destination?.trim() ?? '';
  if (!destination) {
    return {
      supported: false as const,
      availability: 'destination_required' as const,
      destination,
      durationDays: tripResult.data.duration_days ?? null,
      candidates: [],
      selected: [],
    };
  }

  const summary = summaryResult.data?.[0];
  const interests = summary
    ? parseAverageInterests(summary.average_interests)
    : null;
  if (!summary || !interests) {
    throw new Error('Complete Group Travel DNA before choosing places.');
  }

  const travelDna = {
    finite_budget_average:
      summary.finite_budget_average === null
        ? null
        : Number(summary.finite_budget_average),
    unlimited_members: Number(summary.unlimited_members),
    average_pace: Number(summary.average_pace),
    average_interests: interests,
  };
  const candidatePool = destinationCandidatePoolKey(destination);
  let candidates = await getCandidatePlaces(supabase, {
    city: candidatePool,
    travelDna,
    limit: 30,
  });
  let candidateSource = 'existing_catalog';
  let googlePlacesCalls = 0;
  if (candidates.length < 12) {
    const prepared = await importDestinationCandidates(destination);
    candidateSource = 'google_places';
    googlePlacesCalls = prepared.googlePlacesCalls;
    candidates = await getCandidatePlaces(supabase, {
      city: prepared.poolKey,
      travelDna,
      limit: 30,
    });
  }
  if (candidates.length < 8) {
    return {
      supported: false as const,
      availability: 'insufficient_candidates' as const,
      destination,
      durationDays: tripResult.data.duration_days ?? null,
      candidates: [],
      selected: [],
      candidateSource,
      googlePlacesCalls,
    };
  }

  const votes = votesResult.data ?? [];
  const totalMembers = membersResult.count ?? membersResult.data?.length ?? 0;
  const ranked = rankCandidates(
    candidates.map((candidate) => {
      const placeVotes = votes.filter((vote) => vote.place_id === candidate.id);
      const voteCount = placeVotes.length;
      return {
        ...candidate,
        voteCount,
        totalMembers,
        currentUserSelected: placeVotes.some((vote) => vote.user_id === userId),
        groupScore: groupScore(candidate.score, voteCount, totalMembers),
      };
    }),
  );
  const selected = ranked.filter((place) => place.voteCount > 0);
  const stayArea = getStayAreaRecommendation(selected, candidates);
  const dayGroups = clusterSelectedPlacesByDay(
    selected,
    tripResult.data.duration_days ?? 3,
    candidates,
    stayArea.recommendedArea?.area ?? null,
  );
  const draftSchedule = createDeterministicDraftSchedule(
    dayGroups,
    candidates,
    stayArea.recommendedArea?.area ?? null,
  );

  return {
    supported: true as const,
    destination,
    durationDays: tripResult.data.duration_days ?? null,
    candidates: ranked,
    selected,
    stayArea,
    dayGroups,
    draftSchedule,
    candidateSource,
    googlePlacesCalls,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) {
    return unavailable('Please reconnect and retry.', 401, 'AUTH_REQUIRED');
  }

  try {
    const { id } = await context.params;
    const plan = await loadPhase9Plan(
      authenticated.supabase,
      authenticated.user.id,
      id,
    );
    if (!plan) {
      return unavailable('This trip is unavailable.', 404, 'TRIP_UNAVAILABLE');
    }
    if (!plan.supported) return Response.json(plan);

    const scheduleFingerprint = createScheduleFingerprint(
      plan.draftSchedule,
      plan.selected,
    );
    const persisted = await loadItineraryPageData(authenticated.supabase, id);
    const hasPersistedItinerary = Boolean(persisted?.itinerary);
    let scheduleMatchesPersistedItinerary = false;
    let confirmationIssue: string | null = null;
    try {
      const desired = normalizePhase9Itinerary({
        destination: plan.destination,
        candidates: plan.candidates,
        grouping: plan.dayGroups,
        schedule: plan.draftSchedule,
      });
      scheduleMatchesPersistedItinerary = phase9ItineraryMatchesPersisted(
        desired,
        persisted?.itinerary ?? null,
      );
    } catch (error) {
      confirmationIssue =
        error instanceof Phase9ItineraryBridgeError
          ? error.message
          : 'This schedule cannot be opened in the map yet.';
    }

    return Response.json({
      ...plan,
      scheduleFingerprint,
      hasPersistedItinerary,
      scheduleMatchesPersistedItinerary,
      confirmationIssue,
    });
  } catch (error) {
    const message =
      error instanceof Phase2ProviderError
        ? error.code === 'GOOGLE_PLACES_UNAVAILABLE'
          ? 'Real-place search is temporarily unavailable. Please try again.'
          : 'We could not find enough verified places. Please try again.'
        : error instanceof Error &&
            error.message ===
              'Candidate preparation is not configured on the server.'
          ? error.message
          : 'We could not prepare candidate places. Please try again.';
    return unavailable(message, 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) {
    return unavailable('Please reconnect and retry.', 401, 'AUTH_REQUIRED');
  }
  const body = (await request.json().catch(() => null)) as {
    placeId?: unknown;
    selected?: unknown;
  } | null;
  if (typeof body?.placeId !== 'string' || typeof body.selected !== 'boolean') {
    return unavailable('Choose a valid place.', 400, 'INVALID_PLACE');
  }
  const { id } = await context.params;
  const { supabase, user } = authenticated;
  if (body.selected) {
    const { error } = await supabase.from('trip_place_votes').upsert(
      {
        trip_id: id,
        place_id: body.placeId,
        user_id: user.id,
        selected: true,
      },
      { onConflict: 'trip_id,place_id,user_id' },
    );
    if (error) return unavailable(error.message, 500);
  } else {
    const { error } = await supabase
      .from('trip_place_votes')
      .delete()
      .eq('trip_id', id)
      .eq('place_id', body.placeId)
      .eq('user_id', user.id);
    if (error) return unavailable(error.message, 500);
  }
  return Response.json({ ok: true });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) {
    return unavailable('Please reconnect and retry.', 401, 'AUTH_REQUIRED');
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      expectedFingerprint?: unknown;
      replaceExisting?: unknown;
    } | null;
    const expectedFingerprint =
      typeof body?.expectedFingerprint === 'string'
        ? body.expectedFingerprint
        : '';
    if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
      return unavailable(
        'Refresh this schedule before opening the map plan.',
        400,
        'INVALID_SCHEDULE_FINGERPRINT',
      );
    }

    const { id } = await context.params;
    const plan = await loadPhase9Plan(
      authenticated.supabase,
      authenticated.user.id,
      id,
    );
    if (!plan) {
      return unavailable('This trip is unavailable.', 404, 'TRIP_UNAVAILABLE');
    }
    if (!plan.supported) {
      return unavailable(
        'Map handoff is currently available for Kuala Lumpur trips only.',
        400,
        'DESTINATION_UNSUPPORTED',
      );
    }

    const currentFingerprint = createScheduleFingerprint(
      plan.draftSchedule,
      plan.selected,
    );
    if (currentFingerprint !== expectedFingerprint) {
      return unavailable(
        "Your group's choices changed while you were reviewing. We refreshed the schedule so you can confirm the latest plan.",
        409,
        'SCHEDULE_CHANGED',
      );
    }

    const desired = normalizePhase9Itinerary({
      destination: plan.destination,
      candidates: plan.candidates,
      grouping: plan.dayGroups,
      schedule: plan.draftSchedule,
    });
    const current = await loadItineraryPageData(authenticated.supabase, id);
    const hasPersistedItinerary = Boolean(current?.itinerary);
    if (phase9ItineraryMatchesPersisted(desired, current?.itinerary ?? null)) {
      return Response.json({
        ok: true,
        outcome: 'unchanged',
        savedItems: desired.items.length,
      });
    }
    if (hasPersistedItinerary && body?.replaceExisting !== true) {
      return unavailable(
        'Your current map edits will be replaced with this newly organised schedule.',
        409,
        'EXISTING_PLAN_REPLACEMENT_REQUIRED',
      );
    }

    const { data: saveRows, error: saveError } =
      await authenticated.supabase.rpc('replace_generated_itinerary', {
        p_trip_id: id,
        p_destination: plan.destination,
        p_places: desired.places as unknown as Json,
        p_items: desired.items as unknown as Json,
      });
    if (saveError) throw saveError;
    if (Number(saveRows?.[0]?.saved_items) !== desired.items.length) {
      throw new Error('The map plan could not be saved completely.');
    }

    const persisted = await loadItineraryPageData(authenticated.supabase, id);
    if (
      !persisted?.itinerary ||
      !phase9ItineraryMatchesPersisted(desired, persisted.itinerary)
    ) {
      throw new Error(
        'The saved map plan did not match the confirmed schedule.',
      );
    }

    return Response.json({
      ok: true,
      outcome: hasPersistedItinerary ? 'replaced' : 'created',
      savedItems: desired.items.length,
    });
  } catch (error) {
    if (error instanceof Phase9ItineraryBridgeError) {
      return unavailable(error.message, 422, 'UNGROUNDED_SCHEDULE_PLACE', {
        placeName: error.placeName,
      });
    }
    return unavailable(
      error instanceof Error
        ? error.message
        : 'The map plan could not be saved.',
      500,
      'MAP_PLAN_SAVE_FAILED',
    );
  }
}
