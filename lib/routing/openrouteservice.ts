import 'server-only';

import type { ItineraryItemView } from '@/lib/phase2/types';
import type { RouteSegment, TripRoute } from './types';

const DIRECTIONS_URL =
  'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';

type Coordinate = [number, number];

type OpenRouteFeature = {
  geometry?: { type?: unknown; coordinates?: unknown };
  properties?: {
    summary?: { distance?: unknown; duration?: unknown };
    segments?: { distance?: unknown; duration?: unknown }[];
  };
};

type OpenRouteResponse = { features?: OpenRouteFeature[] };

export class OpenRouteServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouteServiceError';
  }
}

export function hasRoutingCoordinates(item: ItineraryItemView) {
  const { latitude, longitude } = item.place;
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function toCoordinate(value: unknown): Coordinate | null {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== 'number' ||
    !Number.isFinite(value[0]) ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[1])
  ) {
    return null;
  }
  return [value[0], value[1]];
}

function nonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export async function getDrivingRoute(
  items: ItineraryItemView[],
): Promise<TripRoute> {
  const validItems = items.filter(hasRoutingCoordinates);
  if (validItems.length < 2) {
    return {
      geometry: null,
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      segments: [],
    };
  }

  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) throw new OpenRouteServiceError('OPENROUTESERVICE_UNAVAILABLE');

  let response: Response;
  try {
    response = await fetch(DIRECTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({
        coordinates: validItems.map(
          (item) => [item.place.longitude, item.place.latitude] as Coordinate,
        ),
      }),
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
  } catch {
    throw new OpenRouteServiceError('OPENROUTESERVICE_UNAVAILABLE');
  }

  if (!response.ok) {
    throw new OpenRouteServiceError('OPENROUTESERVICE_UNAVAILABLE');
  }

  const payload = (await response
    .json()
    .catch(() => null)) as OpenRouteResponse | null;
  const feature = payload?.features?.[0];
  const coordinates = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates
        .map(toCoordinate)
        .filter((coordinate): coordinate is Coordinate => coordinate !== null)
    : [];
  const summaryDistance = nonNegativeNumber(
    feature?.properties?.summary?.distance,
  );
  const summaryDuration = nonNegativeNumber(
    feature?.properties?.summary?.duration,
  );
  const rawSegments = feature?.properties?.segments ?? [];

  if (
    feature?.geometry?.type !== 'LineString' ||
    coordinates.length < 2 ||
    summaryDistance === null ||
    summaryDuration === null ||
    rawSegments.length !== validItems.length - 1
  ) {
    throw new OpenRouteServiceError('OPENROUTESERVICE_INVALID_RESPONSE');
  }

  const segments: RouteSegment[] = rawSegments.flatMap((segment, index) => {
    const distanceMeters = nonNegativeNumber(segment.distance);
    const durationSeconds = nonNegativeNumber(segment.duration);
    const from = validItems[index];
    const to = validItems[index + 1];
    if (!from || !to || distanceMeters === null || durationSeconds === null) {
      return [];
    }
    return [
      {
        fromItemId: from.id,
        toItemId: to.id,
        distanceMeters,
        durationSeconds,
      },
    ];
  });

  if (segments.length !== validItems.length - 1) {
    throw new OpenRouteServiceError('OPENROUTESERVICE_INVALID_RESPONSE');
  }

  return {
    geometry: { type: 'LineString', coordinates },
    totalDistanceMeters: summaryDistance,
    totalDurationSeconds: summaryDuration,
    segments,
  };
}
