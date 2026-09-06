import type { Json } from '@/lib/supabase/database.types';

export type TripEndpoint = {
  googlePlaceId: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

export type TripTimeConstraints = {
  arrivalTime: string | null;
  departureTime: string | null;
  arrivalPoint: TripEndpoint | null;
  departurePoint: TripEndpoint | null;
};

export function parseTimeMinutes(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function parseTripEndpoint(value: Json | null): TripEndpoint | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const googlePlaceId = value.googlePlaceId;
  const name = value.name;
  const address = value.address;
  const latitude = value.latitude;
  const longitude = value.longitude;
  return typeof googlePlaceId === 'string' &&
    googlePlaceId.length > 0 &&
    typeof name === 'string' &&
    name.length > 0 &&
    (address === null || typeof address === 'string') &&
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
    ? { googlePlaceId, name, address, latitude, longitude }
    : null;
}

export function endpointToJson(endpoint: TripEndpoint): Json {
  return { ...endpoint };
}
