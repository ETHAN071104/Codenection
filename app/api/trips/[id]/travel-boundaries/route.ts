import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  hostOnlyResponse,
  phase2ErrorResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { getPlaceCandidateById } from '@/lib/phase2/google-places';
import {
  endpointToJson,
  parseTripEndpoint,
  type TripEndpoint,
} from '@/lib/trips/travel-boundaries';
import { planningLockResponse } from '@/lib/trips/finalization';

const ENDPOINT_TYPES = new Set([
  'airport',
  'bus_station',
  'ferry_terminal',
  'train_station',
  'transit_station',
]);

type EndpointMode = 'keep' | 'skip' | 'place';
type DepartureEndpointMode = EndpointMode | 'same';

function time(value: unknown) {
  if (value === null || value === '') return null;
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : undefined;
}

function date(value: unknown) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function endpointMode(value: unknown): EndpointMode | null {
  return value === 'keep' || value === 'skip' || value === 'place'
    ? value
    : null;
}

function departureEndpointMode(value: unknown): DepartureEndpointMode | null {
  return value === 'same' ? value : endpointMode(value);
}

async function groundedEndpoint(placeId: unknown): Promise<TripEndpoint> {
  if (typeof placeId !== 'string' || placeId.length < 3) {
    throw new Error('INVALID_TRIP_ENDPOINT');
  }
  const place = await getPlaceCandidateById(placeId);
  if (!place || !place.types.some((type) => ENDPOINT_TYPES.has(type))) {
    throw new Error('INVALID_TRIP_ENDPOINT');
  }
  return {
    googlePlaceId: place.externalPlaceId,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const body = (await request.json().catch(() => null)) as {
      startDate?: unknown;
      endDate?: unknown;
      arrivalTime?: unknown;
      departureTime?: unknown;
      arrivalPointMode?: unknown;
      arrivalPlaceId?: unknown;
      departurePointMode?: unknown;
      departurePlaceId?: unknown;
    } | null;
    const startDate = date(body?.startDate);
    const endDate = date(body?.endDate);
    const arrivalTime = time(body?.arrivalTime);
    const departureTime = time(body?.departureTime);
    const arrivalMode = endpointMode(body?.arrivalPointMode);
    const departureMode = departureEndpointMode(body?.departurePointMode);
    if (
      arrivalTime === undefined ||
      departureTime === undefined ||
      startDate === undefined ||
      endDate === undefined ||
      (startDate !== null && endDate !== null && endDate < startDate) ||
      !arrivalMode ||
      !departureMode
    ) {
      return Response.json(
        {
          error: {
            code: 'INVALID_TRAVEL_BOUNDARIES',
            message: 'Check the arrival and departure details and try again.',
          },
        },
        { status: 400 },
      );
    }

    const { id } = await context.params;
    const planningLock = await planningLockResponse(authenticated.supabase, id);
    if (planningLock) return planningLock;
    const { data: trip, error: tripError } = await authenticated.supabase
      .from('trips')
      .select('created_by, arrival_point, departure_point, duration_days')
      .eq('id', id)
      .maybeSingle();
    if (tripError || !trip) return unavailableTripResponse();
    if (trip.created_by !== authenticated.user.id) return hostOnlyResponse();

    const existingArrival = parseTripEndpoint(trip.arrival_point);
    const existingDeparture = parseTripEndpoint(trip.departure_point);
    const arrivalPoint =
      arrivalMode === 'keep'
        ? existingArrival
        : arrivalMode === 'place'
          ? await groundedEndpoint(body?.arrivalPlaceId)
          : null;
    const departurePoint =
      departureMode === 'same'
        ? arrivalPoint
        : departureMode === 'keep'
          ? existingDeparture
          : departureMode === 'place'
            ? await groundedEndpoint(body?.departurePlaceId)
            : null;
    if (departureMode === 'same' && !arrivalPoint) {
      return Response.json(
        {
          error: {
            code: 'ARRIVAL_POINT_REQUIRED',
            message: 'Choose an arrival point before reusing it for departure.',
          },
        },
        { status: 400 },
      );
    }

    const { data, error } = await authenticated.supabase
      .from('trips')
      .update({
        start_date: startDate,
        end_date: endDate,
        duration_days:
          startDate && endDate
            ? Math.floor(
                (Date.parse(`${endDate}T00:00:00Z`) -
                  Date.parse(`${startDate}T00:00:00Z`)) /
                  86_400_000,
              ) + 1
            : trip.duration_days,
        arrival_time: arrivalTime,
        departure_time: departureTime,
        arrival_point: arrivalPoint ? endpointToJson(arrivalPoint) : null,
        departure_point: departurePoint ? endpointToJson(departurePoint) : null,
        planning_mode: null,
        setup_stage: 'scope',
      })
      .eq('id', id)
      .select(
        'start_date, end_date, arrival_time, departure_time, arrival_point, departure_point, setup_stage',
      )
      .maybeSingle();
    if (error || !data) return unavailableTripResponse();

    return Response.json({
      startDate: data.start_date,
      endDate: data.end_date,
      arrivalTime: data.arrival_time?.slice(0, 5) ?? null,
      departureTime: data.departure_time?.slice(0, 5) ?? null,
      arrivalPoint: parseTripEndpoint(data.arrival_point),
      departurePoint: parseTripEndpoint(data.departure_point),
      setupStage: data.setup_stage,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_TRIP_ENDPOINT') {
      return Response.json(
        {
          error: {
            code: error.message,
            message: 'Choose a grounded airport or transport arrival point.',
          },
        },
        { status: 400 },
      );
    }
    return phase2ErrorResponse(error);
  }
}
