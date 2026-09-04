import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json, Database } from '@/lib/supabase/database.types';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import {
  getDrivingRoute,
  OpenRouteServiceError,
} from '@/lib/routing/openrouteservice';
import type { TripRoute } from '@/lib/routing/types';
import type { PlannerMutationResponse } from './types';
import { calculateDaySchedule } from './scheduling';

const EMPTY_ROUTE: TripRoute = {
  geometry: null,
  totalDistanceMeters: 0,
  totalDurationSeconds: 0,
  segments: [],
};

export async function finalizePlannerDay(
  supabase: SupabaseClient<Database>,
  tripId: string,
  dayNumber: number,
): Promise<PlannerMutationResponse> {
  const beforeSchedule = await loadItineraryPageData(supabase, tripId);
  if (!beforeSchedule) throw new Error('TRIP_UNAVAILABLE');

  const day = beforeSchedule.itinerary?.days.find(
    (entry) => entry.day === dayNumber,
  );
  let route = EMPTY_ROUTE;
  if (day) {
    try {
      route = await getDrivingRoute(day.items);
    } catch (error) {
      if (!(error instanceof OpenRouteServiceError)) throw error;
    }
  }

  if (day && day.items.length > 0) {
    const schedule = calculateDaySchedule(day.items, route);
    const { data: scheduleRows, error: scheduleError } = await supabase.rpc(
      'reschedule_itinerary_day',
      {
        p_trip_id: tripId,
        p_day_number: dayNumber,
        p_schedule: schedule as unknown as Json,
      },
    );
    if (scheduleError || scheduleRows?.length !== day.items.length) {
      throw scheduleError ?? new Error('SCHEDULE_SAVE_FAILED');
    }
  }

  const data = await loadItineraryPageData(supabase, tripId);
  if (!data) throw new Error('TRIP_UNAVAILABLE');
  return { data, day: dayNumber, route };
}
