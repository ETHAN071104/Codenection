import type { ItineraryItemView } from '@/lib/phase2/types';
import type { TripEndpoint } from '@/lib/trips/travel-boundaries';

export const ARRIVAL_ENDPOINT_ID = 'arrival-endpoint';
export const DEPARTURE_ENDPOINT_ID = 'departure-endpoint';
export const STAY_ENDPOINT_ID = 'stay-endpoint';

export type RoutingPoint = {
  id: string;
  longitude: number;
  latitude: number;
};

export function buildRoutingPoints(
  items: ItineraryItemView[],
  endpoints?: {
    start?: TripEndpoint | null;
    end?: TripEndpoint | null;
    startId?: string;
    endId?: string;
  },
): RoutingPoint[] {
  const result: RoutingPoint[] = [];
  if (endpoints?.start) {
    result.push({
      id: endpoints.startId ?? ARRIVAL_ENDPOINT_ID,
      longitude: endpoints.start.longitude,
      latitude: endpoints.start.latitude,
    });
  }
  for (const item of items) {
    const { latitude, longitude } = item.place;
    if (
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      typeof longitude === 'number' &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      result.push({ id: item.id, longitude, latitude });
    }
  }
  if (endpoints?.end) {
    result.push({
      id: endpoints.endId ?? DEPARTURE_ENDPOINT_ID,
      longitude: endpoints.end.longitude,
      latitude: endpoints.end.latitude,
    });
  }
  return result;
}
