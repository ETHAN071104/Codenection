import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { getWeatherForDay } from '@/lib/weather/open-meteo';

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
          error: { code: 'INVALID_DAY', message: 'Choose a valid trip day.' },
        },
        { status: 400 },
      );
    }
    const data = await loadItineraryPageData(authenticated.supabase, id);
    const itineraryDay = data?.itinerary?.days.find(
      (entry) => entry.day === day,
    );
    if (!data || !itineraryDay) return unavailableTripResponse();

    return Response.json(
      await getWeatherForDay({
        items: itineraryDay.items,
        day,
        startDate: data.trip.startDate,
      }),
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch {
    return Response.json(
      {
        error: {
          code: 'WEATHER_UNAVAILABLE',
          message: 'Weather is temporarily unavailable.',
        },
      },
      { status: 502 },
    );
  }
}
