import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  unavailableTripResponse,
  unauthorizedResponse,
} from '@/lib/phase2/api-error';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import {
  getDrivingRoute,
  OpenRouteServiceError,
} from '@/lib/routing/openrouteservice';

function routeErrorResponse(error: unknown) {
  const code =
    error instanceof OpenRouteServiceError
      ? error.message
      : 'ROUTE_UNAVAILABLE';
  return Response.json(
    {
      error: {
        code,
        message: 'Route unavailable. Your itinerary is still available.',
      },
    },
    { status: 502 },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const day = Number(new URL(request.url).searchParams.get('day'));
    if (!Number.isInteger(day) || day < 1 || day > 30) {
      return Response.json(
        {
          error: {
            code: 'INVALID_DAY',
            message: 'That itinerary day is invalid.',
          },
        },
        { status: 400 },
      );
    }

    const { data: membership, error: membershipError } =
      await authenticated.supabase
        .from('trip_members')
        .select('id')
        .eq('trip_id', id)
        .eq('user_id', authenticated.user.id)
        .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return unavailableTripResponse();

    const data = await loadItineraryPageData(authenticated.supabase, id);
    if (!data?.itinerary) return unavailableTripResponse();
    const selectedDay = data.itinerary.days.find((entry) => entry.day === day);
    if (!selectedDay) {
      return Response.json(
        {
          error: {
            code: 'INVALID_DAY',
            message: 'That itinerary day is invalid.',
          },
        },
        { status: 400 },
      );
    }

    const firstDay = data.itinerary.days[0]?.day;
    const finalDay = data.itinerary.days.at(-1)?.day;
    const route = await getDrivingRoute(selectedDay.items, {
      start: day === firstDay ? data.trip.arrivalPoint : null,
      end: day === finalDay ? data.trip.departurePoint : null,
    });
    return Response.json(route, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
