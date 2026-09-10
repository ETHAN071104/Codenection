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
import {
  ARRIVAL_ENDPOINT_ID,
  DEPARTURE_ENDPOINT_ID,
  STAY_ENDPOINT_ID,
} from '@/lib/routing/route-points-core';
import { tripDayRouteAnchors } from '@/lib/trips/travel-boundaries';

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
  options?: { allowFinalizedMutation?: boolean },
): Promise<PlannerMutationResponse> {
  const beforeSchedule = await loadItineraryPageData(supabase, tripId);
  if (!beforeSchedule) throw new Error('TRIP_UNAVAILABLE');

  const day = beforeSchedule.itinerary?.days.find(
    (entry) => entry.day === dayNumber,
  );
  let route = EMPTY_ROUTE;
  if (day) {
    try {
      const days = beforeSchedule.itinerary?.days ?? [];
      const anchors = tripDayRouteAnchors({
        firstDay: dayNumber === days[0]?.day,
        finalDay: dayNumber === days.at(-1)?.day,
        arrivalPoint: beforeSchedule.trip.arrivalPoint,
        departurePoint: beforeSchedule.trip.departurePoint,
        stayAnchor: beforeSchedule.trip.stayAnchor,
      });
      route = await getDrivingRoute(day.items, {
        start: anchors.start,
        end: anchors.end,
        startId:
          anchors.startKind === 'arrival'
            ? ARRIVAL_ENDPOINT_ID
            : STAY_ENDPOINT_ID,
        endId:
          anchors.endKind === 'departure'
            ? DEPARTURE_ENDPOINT_ID
            : STAY_ENDPOINT_ID,
      });
    } catch (error) {
      if (!(error instanceof OpenRouteServiceError)) throw error;
    }
  }

  if (day && day.items.length > 0) {
    const schedule = calculateDaySchedule(day.items, route);
    const { data: scheduleRows, error: scheduleError } = await supabase.rpc(
      options?.allowFinalizedMutation
        ? 'reschedule_post_planning_itinerary_day'
        : 'reschedule_itinerary_day',
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
