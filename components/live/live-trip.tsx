'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock3,
  CloudRain,
  CloudSun,
  LoaderCircle,
  MapPin,
  Navigation,
  WalletCards,
} from 'lucide-react';
import { AtlasShell } from '@/components/travel-dna/atlas-shell';
import {
  Map as Mapcn,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  useMap,
} from '@/components/ui/map';
import { phase2Fetch } from '@/lib/phase2/client';
import type { ItineraryItemView, ItineraryPageData } from '@/lib/phase2/types';
import type { WeatherAtStop, WeatherDayResponse } from '@/lib/planner/types';
import type { RouteSegment, TripRoute } from '@/lib/routing/types';
import { useTripRealtime } from '@/lib/realtime/use-trip-realtime';
import { cn } from '@/lib/utils';

function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatDistance(meters: number) {
  return meters < 1_000
    ? `${Math.round(meters)} m`
    : `${(meters / 1_000).toFixed(1)} km`;
}

function formatTravel(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function estimateStopCost(item: ItineraryItemView) {
  if (item.estimatedCost !== null) return item.estimatedCost;
  const types = new Set(item.place.types);
  if (
    types.has('park') ||
    types.has('place_of_worship') ||
    types.has('public_square')
  ) {
    return 0;
  }
  if (
    types.has('restaurant') ||
    types.has('cafe') ||
    types.has('food') ||
    types.has('bakery')
  ) {
    const priceEstimates: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 30,
      PRICE_LEVEL_MODERATE: 60,
      PRICE_LEVEL_EXPENSIVE: 110,
      PRICE_LEVEL_VERY_EXPENSIVE: 180,
    };
    return item.place.priceLevel
      ? (priceEstimates[item.place.priceLevel] ?? 45)
      : 45;
  }
  if (
    types.has('museum') ||
    types.has('tourist_attraction') ||
    types.has('historical_landmark')
  ) {
    return 30;
  }
  return 20;
}

function validCoordinates(item: ItineraryItemView) {
  return (
    typeof item.place.latitude === 'number' &&
    typeof item.place.longitude === 'number'
  );
}

function resolveActiveDay(data: ItineraryPageData | null, now: Date) {
  const days = data?.itinerary?.days ?? [];
  if (days.length === 0) return null;
  if (data?.trip.startDate) {
    const start = new Date(`${data.trip.startDate}T00:00:00`).getTime();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const dayNumber = Math.floor((today.getTime() - start) / 86_400_000) + 1;
    const matched = days.find((day) => day.day === dayNumber);
    if (matched) return matched;
  }
  return days[0];
}

function LiveMapViewport({ items }: { items: ItineraryItemView[] }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || items.length === 0) return;
    const valid = items.filter(validCoordinates);
    if (valid.length === 1) {
      map.easeTo({
        center: [valid[0].place.longitude!, valid[0].place.latitude!],
        zoom: 13,
      });
      return;
    }
    if (valid.length > 1) {
      const longitudes = valid.map((item) => item.place.longitude!);
      const latitudes = valid.map((item) => item.place.latitude!);
      map.fitBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)],
        ],
        { padding: 70, maxZoom: 14 },
      );
    }
  }, [isLoaded, items, map]);
  return null;
}

function LiveMap({
  items,
  route,
}: {
  items: ItineraryItemView[];
  route: TripRoute | null;
}) {
  const valid = items.filter(validCoordinates);
  const first = valid[0];
  if (!first) {
    return (
      <div className="flex min-h-[320px] items-center justify-center bg-[#e7e0cd] text-sm text-[#5a5d61]">
        Map unavailable for these stops
      </div>
    );
  }
  return (
    <Mapcn
      center={[first.place.longitude!, first.place.latitude!]}
      zoom={12}
      theme="light"
      className="h-full min-h-[320px]"
    >
      <LiveMapViewport items={valid} />
      {route?.geometry && (
        <MapRoute
          id="live-driving-route"
          coordinates={route.geometry.coordinates}
          color="#2f3237"
          width={4}
          opacity={0.75}
          interactive={false}
        />
      )}
      <MapControls />
      {valid.map((item, index) => (
        <MapMarker
          key={item.id}
          longitude={item.place.longitude!}
          latitude={item.place.latitude!}
        >
          <MarkerContent>
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-full border-2 border-[#f8f4e8] text-sm font-bold shadow-[0_6px_16px_rgb(37_40_45/30%)]',
                index === 0
                  ? 'scale-110 bg-[#1f2227] text-[#f8f4e8]'
                  : 'bg-[#2f3237] text-[#f8f4e8]',
              )}
              aria-label={`${index + 1}. ${item.place.name}`}
            >
              {index + 1}
            </div>
          </MarkerContent>
        </MapMarker>
      ))}
    </Mapcn>
  );
}

function WeatherLine({ weather }: { weather: WeatherAtStop | null }) {
  if (!weather || weather.temperatureC === null) return null;
  const WeatherIcon =
    (weather.precipitationProbability ?? 0) >= 50 ? CloudRain : CloudSun;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-[#5a5d61]">
      <WeatherIcon className="size-4" aria-hidden="true" />
      {weather.condition}, {Math.round(weather.temperatureC)}°C
      {weather.precipitationProbability !== null &&
        `, ${Math.round(weather.precipitationProbability)}% rain`}
    </span>
  );
}

export function LiveTrip({ tripId }: { tripId: string }) {
  const [data, setData] = useState<ItineraryPageData | null>(null);
  const [route, setRoute] = useState<TripRoute | null>(null);
  const [weather, setWeather] = useState(new Map<string, WeatherAtStop>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const nextData = await phase2Fetch<ItineraryPageData>(
          `/api/trips/${tripId}/itinerary`,
        );
        setData(nextData);
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Live Trip is unavailable.',
        );
      } finally {
        setLoading(false);
      }
    },
    [tripId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(true));
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useTripRealtime({
    tripId,
    editingItemId: null,
    onItineraryChange: () => void load(false),
  });

  const activeDay = resolveActiveDay(data, now);
  const activeDayNumber = activeDay?.day ?? null;
  const activeDayRevision =
    activeDay?.items
      .map((item) => `${item.id}:${item.sortOrder}:${item.plannedTime}`)
      .join('|') ?? '';

  useEffect(() => {
    let cancelled = false;
    if (activeDayNumber === null) return;
    Promise.all([
      phase2Fetch<TripRoute>(
        `/api/trips/${tripId}/route?day=${activeDayNumber}`,
      ),
      phase2Fetch<WeatherDayResponse>(
        `/api/trips/${tripId}/weather?day=${activeDayNumber}`,
      ),
    ])
      .then(([nextRoute, nextWeather]) => {
        if (cancelled) return;
        setRoute(nextRoute);
        setWeather(
          new Map(nextWeather.stops.map((stop) => [stop.itemId, stop])),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setRoute(null);
          setWeather(new Map());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeDayNumber, activeDayRevision, tripId]);

  if (loading) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="LIVE TRIP">
        <div className="mx-auto flex items-center gap-3 text-[#5a5d61]">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Preparing today&apos;s trip
        </div>
      </AtlasShell>
    );
  }

  if (error || !data?.itinerary || !activeDay) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="LIVE TRIP">
        <section className="mx-auto w-full max-w-xl border border-[#35383d]/30 bg-[#fffdf8] p-8">
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">
            Live Trip unavailable
          </h1>
          <p className="mt-4 text-[#5a5d61]">
            {error ?? 'Generate an itinerary before starting Live Trip.'}
          </p>
          <Link
            href={`/trip/${tripId}/plan`}
            className="mt-6 inline-flex items-center gap-2 font-semibold underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to planner
          </Link>
        </section>
      </AtlasShell>
    );
  }

  const todayIso = now.toISOString().slice(0, 10);
  const tripDate = data.trip.startDate
    ? new Date(
        new Date(`${data.trip.startDate}T12:00:00Z`).getTime() +
          (activeDay.day - 1) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10)
    : todayIso;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const remaining = activeDay.items.filter((item) => {
    if (tripDate !== todayIso) return true;
    return (
      toMinutes(item.plannedTime) + item.estimatedDurationMinutes > nowMinutes
    );
  });
  const current = remaining[0] ?? null;
  const next = remaining[1] ?? null;
  const later = remaining.slice(2);
  const nextSegment: RouteSegment | null =
    current && next
      ? (route?.segments.find(
          (segment) =>
            segment.fromItemId === current.id && segment.toItemId === next.id,
        ) ?? null)
      : null;
  const estimatedToday = activeDay.items.reduce(
    (total, item) => total + estimateStopCost(item),
    0,
  );
  const includesCategoryEstimates = activeDay.items.some(
    (item) => item.estimatedCost === null,
  );
  const nextWeather = next ? (weather.get(next.id) ?? null) : null;
  const minutesUntilNext = next
    ? toMinutes(next.plannedTime) - nowMinutes
    : null;
  const contextMessage =
    nextWeather && (nextWeather.precipitationProbability ?? 0) >= 60
      ? `Rain is likely at ${next?.place.name}. Keep a covered option nearby.`
      : minutesUntilNext !== null && minutesUntilNext > 0 && minutesUntilNext < 90
        ? `${next?.place.name} begins in ${minutesUntilNext} minutes.`
        : 'Your saved route and schedule are ready for the day.';

  return (
    <AtlasShell tripId={tripId} sectionLabel="LIVE TRIP">
      <section className="w-full py-2">
        <div className="flex flex-col gap-4 border-b border-[#35383d]/30 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-[0.08em]">
              DAY {activeDay.day} IN PROGRESS
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              {data.itinerary.destination}
            </h1>
          </div>
          <Link
            href={`/trip/${tripId}/plan`}
            className="inline-flex items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to planner
          </Link>
        </div>

        <div className="mt-5 grid overflow-hidden border border-[#35383d]/30 bg-[#fffdf8] lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="min-h-[360px] bg-[#e7e0cd] lg:min-h-[calc(100dvh-220px)]">
            <LiveMap items={remaining} route={route} />
          </div>
          <aside className="max-h-none overflow-y-auto lg:max-h-[calc(100dvh-220px)]">
            <div className="border-b border-[#35383d]/20 bg-[#f2eee1] p-5">
              <div className="flex items-start gap-3">
                <Navigation
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <p className="text-sm leading-6">{contextMessage}</p>
              </div>
            </div>

            {current ? (
              <div className="p-5 sm:p-6">
                <p className="text-xs font-semibold tracking-[0.12em]">NOW</p>
                <div className="mt-3 border-l-2 border-[#2f3237] pl-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="text-xl font-semibold">
                      {current.place.name}
                    </h2>
                    <time className="font-mono text-sm">
                      {current.plannedTime}
                    </time>
                  </div>
                  <p className="mt-2 text-sm text-[#5a5d61]">
                    {current.estimatedDurationMinutes} min planned
                  </p>
                  <div className="mt-2">
                    <WeatherLine weather={weather.get(current.id) ?? null} />
                  </div>
                </div>

                {next && (
                  <div className="mt-8 border-t border-[#35383d]/25 pt-5">
                    <p className="text-xs font-semibold tracking-[0.12em]">
                      NEXT
                    </p>
                    <div className="mt-3 flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold">{next.place.name}</h3>
                        <div className="mt-2">
                          <WeatherLine weather={weather.get(next.id) ?? null} />
                        </div>
                      </div>
                      <time className="font-mono text-sm">
                        {next.plannedTime}
                      </time>
                    </div>
                    {nextSegment && (
                      <p className="mt-3 inline-flex items-center gap-2 text-sm text-[#5a5d61]">
                        <MapPin className="size-4" aria-hidden="true" />
                        {formatTravel(nextSegment.durationSeconds)} travel,{' '}
                        {formatDistance(nextSegment.distanceMeters)}
                      </p>
                    )}
                  </div>
                )}

                {later.length > 0 && (
                  <div className="mt-8 border-t border-[#35383d]/25 pt-5">
                    <p className="text-xs font-semibold tracking-[0.12em]">
                      LATER
                    </p>
                    <div className="mt-3 space-y-4">
                      {later.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-4"
                        >
                          <div>
                            <p className="text-sm font-semibold">
                              {item.place.name}
                            </p>
                            <WeatherLine
                              weather={weather.get(item.id) ?? null}
                            />
                          </div>
                          <time className="font-mono text-sm">
                            {item.plannedTime}
                          </time>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center">
                <Clock3 className="mx-auto size-5" aria-hidden="true" />
                <h2 className="mt-3 text-xl font-semibold">Day complete</h2>
                <p className="mt-2 text-sm text-[#5a5d61]">
                  All scheduled stops for today have passed.
                </p>
              </div>
            )}

            <div className="border-t border-[#35383d]/25 bg-[#f7f3e8] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.1em]">
                    ESTIMATED TODAY
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    RM {Math.round(estimatedToday)}
                  </p>
                  {includesCategoryEstimates && (
                    <p className="mt-1 text-xs text-[#5a5d61]">
                      Includes category estimates
                    </p>
                  )}
                </div>
                <WalletCards className="size-6" aria-hidden="true" />
              </div>
            </div>
          </aside>
        </div>
      </section>
    </AtlasShell>
  );
}
