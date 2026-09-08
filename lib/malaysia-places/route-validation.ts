import 'server-only';

import { createHash } from 'node:crypto';
import { getDrivingRouteForPoints } from '@/lib/routing/openrouteservice';
import {
  validateDeterministicScheduleRoutes,
  type RouteValidatedSchedule,
} from './route-validation-core';

export * from './route-validation-core';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const validationCache = new Map<
  string,
  { expiresAt: number; schedule: RouteValidatedSchedule }
>();

type ValidationInput = Omit<
  Parameters<typeof validateDeterministicScheduleRoutes>[0],
  'routeProvider'
>;

function cacheKey(input: ValidationInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        grouping: input.grouping.days.map((day) => ({
          day: day.day,
          places: day.places.map((place) => ({
            id: place.id,
            area: place.area,
            latitude: place.latitude,
            longitude: place.longitude,
            votes: place.voteCount,
          })),
        })),
        stayArea: input.recommendedStayArea,
        stayAreaCoordinates: input.knownPlaces
          .filter((place) => place.area === input.recommendedStayArea)
          .map((place) => [place.id, place.latitude, place.longitude]),
        constraints: input.constraints,
        schedule: input.schedule,
      }),
    )
    .digest('hex');
}

export async function validateScheduleWithOpenRouteService(
  input: ValidationInput,
) {
  const key = cacheKey(input);
  const cached = validationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.schedule;
  if (cached) validationCache.delete(key);

  const schedule = await validateDeterministicScheduleRoutes({
    ...input,
    routeProvider: getDrivingRouteForPoints,
  });
  if (validationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = validationCache.keys().next().value;
    if (oldestKey) validationCache.delete(oldestKey);
  }
  validationCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    schedule,
  });
  return schedule;
}
