import type { Json } from '@/lib/supabase/database.types';
import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { generateGroundedItinerary } from '@/lib/phase2/planning';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { INTERESTS, parseAverageInterests } from '@/lib/preferences/model';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const data = await loadItineraryPageData(authenticated.supabase, id);
    return data ? Response.json(data) : unavailableTripResponse();
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const { data: trip, error: tripError } = await authenticated.supabase
      .from('trips')
      .select('id, destination, duration_days')
      .eq('id', id)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip) return unavailableTripResponse();
    if (!trip.destination) throw new Error('DESTINATION_REQUIRED');

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

    const data = await loadItineraryPageData(authenticated.supabase, id);
    if (!data?.itinerary) throw new Error('ITINERARY_SAVE_FAILED');

    return Response.json({ ...data, metrics: generated.metrics });
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
