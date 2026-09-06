import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  hostOnlyResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { recommendDestination } from '@/lib/phase2/planning';
import { INTERESTS, parseAverageInterests } from '@/lib/preferences/model';
import { getOpenRouterModel } from '@/lib/phase2/openrouter';
import { planningLockResponse } from '@/lib/trips/finalization';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const body = (await request.json().catch(() => null)) as {
      destinationInput?: unknown;
      previousSuggestions?: unknown;
      replaceExisting?: unknown;
    } | null;
    const geographicScope =
      typeof body?.destinationInput === 'string'
        ? body.destinationInput.trim().replace(/\s+/g, ' ')
        : '';
    if (geographicScope && geographicScope.length > 120) {
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
    const previousSuggestions = Array.isArray(body?.previousSuggestions)
      ? body.previousSuggestions
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().replace(/\s+/g, ' '))
          .filter((item) => item.length >= 3 && item.length <= 120)
          .slice(0, 10)
      : [];
    const { id } = await context.params;
    const planningLock = await planningLockResponse(authenticated.supabase, id);
    if (planningLock) return planningLock;
    const { data: trip, error: tripError } = await authenticated.supabase
      .from('trips')
      .select('id, created_by, destination, duration_days')
      .eq('id', id)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip) return unavailableTripResponse();
    if (trip.created_by !== authenticated.user.id) return hostOnlyResponse();
    if (trip.destination && body?.replaceExisting !== true) {
      return Response.json({
        suggestion: {
          destination: trip.destination,
          reason: 'This destination is already set for the trip.',
          inputWasSpecific: true,
        },
        metrics: { model: getOpenRouterModel(), openRouterCalls: 0 },
      });
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
    const suggestion = await recommendDestination({
      durationDays: trip.duration_days ?? 3,
      finiteBudgetAverage:
        summary.finite_budget_average === null
          ? null
          : Number(summary.finite_budget_average),
      unlimitedMembers: Number(summary.unlimited_members),
      averagePace: Number(summary.average_pace),
      topInterests,
      geographicScope: geographicScope || null,
      previousSuggestions,
    });

    return Response.json({
      suggestion,
      metrics: { model: getOpenRouterModel(), openRouterCalls: 1 },
    });
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
