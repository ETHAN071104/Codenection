'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  ArrowUpRight,
  Clock3,
  CloudRain,
  CloudSun,
  MapPin,
  Navigation,
  WalletCards,
} from 'lucide-react';
import { AtlasShell } from '@/components/travel-dna/atlas-shell';
import { ChangeBar } from '@/components/live/change-bar';
import { ActivityWeatherTimeline } from '@/components/live/activity-weather-timeline';
import {
  SystemLoading,
  SystemNotice,
  SystemState,
} from '@/components/ui/system-state';
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
import {
  useTripRealtime,
  type TripRealtimeStatus,
} from '@/lib/realtime/use-trip-realtime';
import type { LiveTripMember } from '@/lib/live/trip-change';
import type { TripChangeEvent } from '@/lib/live/trip-change';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

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

function addMinutesToTime(time: string, minutes: number) {
  const total = (toMinutes(time) + minutes) % 1_440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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
      <div className="flex min-h-[320px] items-center justify-center bg-warm-border p-6 text-center text-warm-muted">
        <div className="max-w-xs rounded-2xl border border-warm-border bg-paper/95 p-6 shadow-editorial">
          <MapPin
            className="mx-auto size-6 text-brown-accent"
            aria-hidden="true"
          />
          <p className="mt-3 font-semibold text-ink">
            Map view is not available.
          </p>
          <p className="mt-2 text-sm leading-6">
            These stops do not have saved coordinates. Today’s timeline is still
            available.
          </p>
        </div>
      </div>
    );
  }
  return (
    <Mapcn
      center={[first.place.longitude!, first.place.latitude!]}
      zoom={12}
      theme="dark"
      className="h-full min-h-[320px]"
    >
      <LiveMapViewport items={valid} />
      {route?.geometry && (
        <MapRoute
          id="live-driving-route"
          coordinates={route.geometry.coordinates}
          color="#e0b58f"
          width={4.5}
          opacity={0.95}
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
                'flex size-9 items-center justify-center rounded-full border-2 border-paper text-sm font-bold shadow-[0_6px_16px_rgb(37_40_45/30%)]',
                index === 0
                  ? 'scale-110 bg-ink text-paper'
                  : 'bg-ink/90 text-paper',
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
    <span className="inline-flex items-center gap-1.5 text-sm text-warm-muted">
      <WeatherIcon className="size-4" aria-hidden="true" />
      {weather.condition}, {Math.round(weather.temperatureC)}°C
      {weather.precipitationProbability !== null &&
        `, ${Math.round(weather.precipitationProbability)}% rain`}
    </span>
  );
}

type LiveBackgroundMode = 'day' | 'night' | 'rain';

function LiveBackground({ mode }: { mode: LiveBackgroundMode }) {
  const [failed, setFailed] = useState<Record<LiveBackgroundMode, boolean>>({
    day: false,
    night: false,
    rain: false,
  });

  return (
    <div className="absolute inset-0 -z-20 overflow-hidden bg-[#111719]" aria-hidden="true">
      {(['day', 'night', 'rain'] as const).map((candidate) => (
        <video
          key={candidate}
          autoPlay
          muted
          loop
          playsInline
          preload={candidate === mode ? 'auto' : 'metadata'}
          onError={() =>
            setFailed((current) => ({ ...current, [candidate]: true }))
          }
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-700 motion-reduce:transition-none',
            candidate === mode && !failed[candidate] ? 'opacity-100' : 'opacity-0',
          )}
        >
          <source src={`/videos/live/${candidate}.mp4`} type="video/mp4" />
        </video>
      ))}
      <div className="absolute inset-0 bg-black/45" />
    </div>
  );
}

function CurrentPlacePhoto({
  tripId,
  item,
}: {
  tripId: string;
  item: ItineraryItemView;
}) {
  const photoName = item.place.photo?.name ?? null;
  const photoUrl = photoName
    ? `/api/trips/${tripId}/place-photo?name=${encodeURIComponent(photoName)}`
    : item.place.externalPlaceId
      ? `/api/trips/${tripId}/place-photo?placeId=${encodeURIComponent(item.place.externalPlaceId)}`
      : null;
  const [photoFailed, setPhotoFailed] = useState(!photoUrl);
  const attribution = item.place.photo?.attributions[0] ?? null;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.15rem] bg-[#d8d2c9]">
      {photoUrl && !photoFailed ? (
        <Image
          src={photoUrl}
          alt={item.place.name}
          fill
          sizes="(min-width: 1024px) 560px, 100vw"
          unoptimized
          priority
          className="object-cover"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <div className="flex size-full min-h-44 items-center justify-center bg-[#d8d2c9] text-[#625b53]">
          <div className="text-center">
            <MapPin className="mx-auto size-7" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold">Place photo unavailable</p>
          </div>
        </div>
      )}
      {!photoFailed && (
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-black/55 px-4 py-3 text-white backdrop-blur-sm">
          <div className="flex min-w-0 items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{item.place.name}</p>
              {item.place.address && (
                <p className="truncate text-xs text-white/72">{item.place.address}</p>
              )}
            </div>
          </div>
          {attribution && (
            <span className="shrink-0 text-[10px] text-white/65">
              Photo by {attribution.displayName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function LiveTrip({ tripId }: { tripId: string }) {
  const [data, setData] = useState<ItineraryPageData | null>(null);
  const [route, setRoute] = useState<TripRoute | null>(null);
  const [weather, setWeather] = useState(new Map<string, WeatherAtStop>());
  const [weatherAvailable, setWeatherAvailable] = useState(false);
  const [routeStatus, setRouteStatus] = useState<ResourceStatus>('idle');
  const [weatherStatus, setWeatherStatus] = useState<ResourceStatus>('idle');
  const [members, setMembers] = useState<LiveTripMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] =
    useState<TripRealtimeStatus>('CONNECTING');
  const [now, setNow] = useState(() => new Date());
  const [explicitRainChangeActive, setExplicitRainChangeActive] =
    useState(false);

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
    let cancelled = false;
    async function loadMembers() {
      try {
        await ensureAnonymousUser();
        const { data: memberRows } = await getSupabaseBrowserClient()
          .from('trip_members')
          .select('id, display_name')
          .eq('trip_id', tripId)
          .order('joined_at', { ascending: true });
        if (!cancelled) {
          setMembers(
            (memberRows ?? []).map((member) => ({
              id: member.id,
              displayName: member.display_name,
            })),
          );
        }
      } catch {
        if (!cancelled) setMembers([]);
      }
    }
    void loadMembers();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useTripRealtime({
    tripId,
    editingItemId: null,
    onItineraryChange: () => void load(false),
    onStatusChange: setRealtimeStatus,
  });

  const activeDay = resolveActiveDay(data, now);
  const activeDayNumber = activeDay?.day ?? null;
  const routeRevision =
    activeDay?.items.map((item) => `${item.id}:${item.sortOrder}`).join('|') ??
    '';
  const weatherRevision =
    activeDay?.items
      .map((item) => `${item.id}:${item.plannedTime}`)
      .join('|') ?? '';

  useEffect(() => {
    let cancelled = false;
    if (activeDayNumber === null) return;
    void Promise.resolve().then(() => {
      if (!cancelled) setRouteStatus('loading');
    });
    phase2Fetch<TripRoute>(`/api/trips/${tripId}/route?day=${activeDayNumber}`)
      .then((nextRoute) => {
        if (cancelled) return;
        setRoute(nextRoute);
        setRouteStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setRoute(null);
          setRouteStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeDayNumber, routeRevision, tripId]);

  useEffect(() => {
    let cancelled = false;
    if (activeDayNumber === null) return;
    void Promise.resolve().then(() => {
      if (!cancelled) setWeatherStatus('loading');
    });
    phase2Fetch<WeatherDayResponse>(
      `/api/trips/${tripId}/weather?day=${activeDayNumber}`,
    )
      .then((nextWeather) => {
        if (!cancelled) {
          setWeather(
            new Map(nextWeather.stops.map((stop) => [stop.itemId, stop])),
          );
          setWeatherAvailable(
            nextWeather.stops.some((stop) => stop.temperatureC !== null),
          );
          setWeatherStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWeather(new Map());
          setWeatherAvailable(false);
          setWeatherStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeDayNumber, tripId, weatherRevision]);

  if (loading) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="LIVE TRIP">
        <SystemLoading
          title="Preparing today’s trip"
          description="We’re loading the current stop, what comes next, and today’s live context."
        />
      </AtlasShell>
    );
  }

  if (error || !data?.itinerary || !activeDay) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="LIVE TRIP">
        <SystemState
          role={error ? 'alert' : 'status'}
          eyebrow="Live trip"
          title={
            error
              ? 'We could not open Live Trip.'
              : 'Live Trip needs a saved itinerary.'
          }
          description={
            error
              ? `${error} Your saved plan has not been changed.`
              : 'Return to the planner to add and save the stops for this trip.'
          }
          actions={
            <>
              {error && (
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink/90"
                >
                  Try again
                </button>
              )}
              <Link
                href={`/trip/${tripId}/plan`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-warm-border bg-paper px-5 text-sm font-semibold text-ink hover:bg-parchment"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back to planner
              </Link>
            </>
          }
        />
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
  const weatherContext =
    nextWeather && nextWeather.temperatureC !== null
      ? `${nextWeather.condition}, ${Math.round(nextWeather.temperatureC)}°C${
          nextWeather.precipitationProbability !== null
            ? `, ${Math.round(nextWeather.precipitationProbability)}% rain`
            : ''
        }`
      : null;
  const weatherDisruptions = remaining.flatMap((item) => {
    const stopWeather = weather.get(item.id);
    const code = stopWeather?.weatherCode ?? null;
    const disruptiveCode =
      code !== null &&
      ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
    if (
      !stopWeather ||
      (!disruptiveCode && (stopWeather.precipitationProbability ?? 0) < 60)
    )
      return [];
    return [{ item, weather: stopWeather }];
  });
  const minutesUntilNext = next
    ? toMinutes(next.plannedTime) - nowMinutes
    : null;
  const contextMessage =
    nextWeather && (nextWeather.precipitationProbability ?? 0) >= 60
      ? `Rain is likely at ${next?.place.name}. Keep a covered option nearby.`
      : minutesUntilNext !== null &&
          minutesUntilNext > 0 &&
          minutesUntilNext < 90
        ? `${next?.place.name} begins in ${minutesUntilNext} minutes.`
        : 'Your saved route and schedule are ready for the day.';

  async function applyScheduleChange(
    event: Extract<TripChangeEvent, { type: 'stay_longer' | 'running_late' }>,
  ) {
    if (!current || activeDayNumber === null) {
      throw new Error('We could not identify the current stop safely.');
    }
    const updated = await phase2Fetch<ItineraryPageData>(
      `/api/trips/${tripId}/schedule-adjustment`,
      {
        method: 'POST',
        body: JSON.stringify({
          day: activeDayNumber,
          currentItemId: current?.id,
          type: event.type,
          minutes: event.minutes,
        }),
      },
    );
    setData(updated);
  }

  async function delayWeatherStop(item: ItineraryItemView, minutes: number) {
    if (activeDayNumber === null)
      throw new Error('We could not identify this day safely.');
    const updated = await phase2Fetch<ItineraryPageData>(
      `/api/trips/${tripId}/schedule-adjustment`,
      {
        method: 'POST',
        body: JSON.stringify({
          day: activeDayNumber,
          currentItemId: item.id,
          type: 'running_late',
          minutes,
        }),
      },
    );
    setData(updated);
  }

  async function skipWeatherStop(item: ItineraryItemView) {
    await phase2Fetch(`/api/trips/${tripId}/live/items`, {
      method: 'DELETE',
      body: JSON.stringify({ itemId: item.id }),
    });
    await load(false);
  }

  const currentWeather = current ? (weather.get(current.id) ?? null) : null;
  const displayWeather = currentWeather ?? nextWeather;
  const backgroundMode: LiveBackgroundMode = explicitRainChangeActive
    ? 'rain'
    : now.getHours() >= 18
      ? 'night'
      : 'day';
  const currentTime = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const weatherHeading = displayWeather
    ? (displayWeather.precipitationProbability ?? 0) >= 60
      ? 'Rain may affect the next move'
      : displayWeather.condition
    : 'Live weather is unavailable';

  return (
    <main className="atlas-page relative isolate min-h-[100dvh] overflow-x-hidden bg-[#111719] text-ink lg:h-[100dvh] lg:overflow-hidden">
      <LiveBackground mode={backgroundMode} />
      <header className="relative z-20 mx-3 mt-3 rounded-[1.35rem] border border-white/15 bg-[#111516]/88 text-paper shadow-[0_18px_50px_rgb(0_0_0/24%)] backdrop-blur-xl sm:mx-6 lg:mx-auto lg:max-w-[1200px]">
        <div className="flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href={`/trip/${tripId}/plan`}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-paper/70"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Back to planner</span>
            <span className="sm:hidden">Planner</span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-paper/25 px-3 py-1.5 text-[11px] font-bold tracking-[0.16em]">
              <span className="size-2 rounded-full bg-[#d6a77a] shadow-[0_0_0_4px_rgb(214_167_122/14%)]" />
              LIVE
            </span>
            <span className="hidden text-sm text-paper/70 sm:inline">
              Day {activeDay.day} in progress
            </span>
          </div>

          <div className="flex min-w-16 items-center justify-end gap-3 text-right text-xs text-paper/75 sm:text-sm">
            {currentWeather?.temperatureC !== null && currentWeather ? (
              <span>{Math.round(currentWeather.temperatureC)}°C</span>
            ) : (
              <span>Day {activeDay.day}</span>
            )}
            <span className="hidden sm:inline">{data.itinerary.destination}</span>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-[1200px] px-3 pb-28 pt-4 sm:px-6 lg:h-[calc(100dvh-82px)] lg:pb-20">
        <div className="sr-only">
          <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
            TODAY&apos;S JOURNEY
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="font-editorial text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-5xl">
              {data.itinerary.destination}
            </h1>
            <p className="text-sm text-warm-muted">
              {remaining.length} stop{remaining.length === 1 ? '' : 's'}{' '}
              remaining
            </p>
          </div>
        </div>

        {weatherStatus === 'error' && (
          <output className="mb-5 block rounded-xl border border-brown-accent/25 bg-paper px-4 py-3 text-sm leading-6 text-ink">
            Weather is unavailable right now. Today’s saved schedule is still
            ready to use.
          </output>
        )}

        {['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(realtimeStatus) && (
          <SystemNotice
            className="mb-5"
            title="Live group updates are paused."
            description="Today’s saved plan is still available. Refresh the page to reconnect before relying on group changes."
            actions={
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="font-semibold text-brown-accent underline-offset-4 hover:underline"
              >
                Refresh
              </button>
            }
          />
        )}

        {current ? (
          <>
            <section
              aria-labelledby="live-now-heading"
              className="grid gap-4 lg:h-full lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,1fr)] lg:grid-rows-[minmax(0,1fr)_156px] lg:gap-4"
            >
              <article className="flex min-h-[520px] flex-col rounded-[1.45rem] border border-white/65 bg-[#f5f0e8]/96 p-5 shadow-[0_24px_70px_rgb(0_0_0/28%)] backdrop-blur-md sm:p-6 lg:row-span-2 lg:min-h-0">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[0.68rem] font-bold tracking-[0.2em] text-brown-accent">
                    TODAY&apos;S JOURNEY
                  </p>
                  <time className="font-mono text-sm text-warm-muted">
                    {currentTime}
                  </time>
                </div>

                <div className="pb-3 pt-2">
                  <h2
                    id="live-now-heading"
                    className="line-clamp-2 max-w-2xl font-editorial text-[clamp(2.4rem,4.7vw,4.4rem)] leading-[0.98] font-medium tracking-[-0.055em]"
                  >
                    {current.place.name}
                  </h2>
                  <p className="mt-3 flex items-center gap-3 text-[0.68rem] font-bold tracking-[0.2em] text-brown-accent">
                    <span className="size-2 rounded-full bg-[#ef6545]" />
                    NOW
                    <span className="h-px flex-1 bg-warm-border" />
                  </p>
                </div>

                <CurrentPlacePhoto key={current.id} tripId={tripId} item={current} />

                <div className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-warm-border py-3 text-sm text-warm-muted">
                  <span className="inline-flex items-center gap-2">
                    <Clock3 className="size-4 text-brown-accent" aria-hidden="true" />
                    {current.estimatedDurationMinutes} min · leave by{' '}
                    {addMinutesToTime(
                      current.plannedTime,
                      current.estimatedDurationMinutes,
                    )}
                  </span>
                  <WeatherLine weather={currentWeather} />
                </div>

                <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="inline-flex max-w-xl items-start gap-2 text-sm leading-6 text-warm-muted">
                    <Navigation
                      className="mt-1 size-4 shrink-0 text-brown-accent"
                      aria-hidden="true"
                    />
                    {contextMessage}
                  </p>
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <WalletCards
                      className="size-4 text-brown-accent"
                      aria-hidden="true"
                    />
                    <span className="font-semibold">
                      RM {Math.round(estimatedToday)}
                    </span>
                    <span className="text-warm-muted">today</span>
                  </div>
                </div>
                {includesCategoryEstimates && (
                  <p className="mt-1 text-right text-[10px] text-warm-muted">
                    Includes category estimates
                  </p>
                )}
              </article>

              <div className="relative min-h-[320px] overflow-hidden rounded-[1.45rem] border border-white/45 bg-[#18201f] shadow-[0_24px_70px_rgb(0_0_0/26%)] lg:min-h-0">
                <LiveMap items={remaining} route={route} />
                <Link
                  href={`/trip/${tripId}/plan`}
                  className="absolute right-4 top-4 z-10 inline-flex h-9 items-center gap-2 rounded-full border border-white/20 bg-black/55 px-4 text-xs font-semibold text-white backdrop-blur-md hover:bg-black/70"
                >
                  Full map
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
                <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl bg-ink/90 px-4 py-3 text-paper shadow-lg backdrop-blur-sm">
                  <p className="text-xs font-semibold tracking-[0.12em] text-paper/65">
                    LIVE ROUTE
                  </p>
                  <p className="mt-1 text-sm">
                    {routeStatus === 'error'
                      ? 'Route details are unavailable. Your stop order is still here.'
                      : routeStatus === 'loading'
                        ? 'Updating route details…'
                        : nextSegment
                          ? `${formatTravel(nextSegment.durationSeconds)} to ${next?.place.name ?? 'your next stop'}`
                          : 'Your stop order is ready.'}
                  </p>
                </div>
              </div>

              <article className="flex min-h-[150px] items-center gap-5 rounded-[1.45rem] border border-white/65 bg-[#f5f0e8]/96 px-6 py-5 shadow-[0_24px_70px_rgb(0_0_0/24%)] backdrop-blur-md">
                {displayWeather && (displayWeather.precipitationProbability ?? 0) >= 50 ? (
                  <CloudRain className="size-9 shrink-0 text-brown-accent" aria-hidden="true" />
                ) : (
                  <CloudSun className="size-9 shrink-0 text-brown-accent" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[0.62rem] font-bold tracking-[0.2em] text-brown-accent">
                    {displayWeather ? 'WEATHER UPDATE' : 'TRIP UPDATE'}
                  </p>
                  <h2 className="mt-1 line-clamp-1 font-editorial text-2xl font-medium tracking-[-0.035em]">
                    {weatherHeading}
                  </h2>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-warm-muted">
                    {contextMessage}
                  </p>
                </div>
                {displayWeather?.temperatureC !== null && displayWeather ? (
                  <span className="self-start font-editorial text-2xl">
                    {Math.round(displayWeather.temperatureC)}°C
                  </span>
                ) : null}
              </article>
            </section>

            {next && (
              <section
                aria-labelledby="live-next-heading"
                className="mt-5 rounded-2xl border border-warm-border bg-paper p-5 shadow-editorial sm:p-6 lg:hidden"
              >
                <div className="grid gap-4 sm:grid-cols-[90px_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                  <div>
                    <p className="text-xs font-bold tracking-[0.18em] text-brown-accent">
                      NEXT
                    </p>
                    <time className="mt-2 block text-2xl font-semibold tracking-[-0.03em]">
                      {next.plannedTime}
                    </time>
                  </div>
                  <div className="border-warm-border sm:border-l sm:pl-6">
                    <h2
                      id="live-next-heading"
                      className="font-editorial text-2xl font-semibold tracking-[-0.03em] sm:text-3xl"
                    >
                      {next.place.name}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                      <span className="text-sm text-warm-muted">
                        {next.estimatedDurationMinutes} min planned
                      </span>
                      <WeatherLine weather={nextWeather} />
                    </div>
                  </div>
                  {nextSegment && (
                    <p className="inline-flex items-center gap-2 text-sm text-warm-muted sm:justify-self-end">
                      <MapPin
                        className="size-4 text-brown-accent"
                        aria-hidden="true"
                      />
                      {formatTravel(nextSegment.durationSeconds)} ·{' '}
                      {formatDistance(nextSegment.distanceMeters)}
                    </p>
                  )}
                </div>
              </section>
            )}

            {later.length > 0 && (
              <section
                aria-labelledby="live-later-heading"
                className="mt-9 sm:mt-11 lg:hidden"
              >
                <div className="flex items-end justify-between gap-4 border-b border-warm-border pb-4">
                  <div>
                    <p className="text-xs font-bold tracking-[0.18em] text-brown-accent">
                      LATER TODAY
                    </p>
                    <h2
                      id="live-later-heading"
                      className="mt-1 font-editorial text-3xl font-semibold tracking-[-0.035em]"
                    >
                      What&apos;s ahead
                    </h2>
                  </div>
                  <span className="text-sm text-warm-muted">
                    {later.length} more
                  </span>
                </div>

                <ol className="divide-y divide-warm-border">
                  {later.map((item, index) => {
                    const remainingIndex = index + 2;
                    const previous = remaining[remainingIndex - 1];
                    const segment = previous
                      ? (route?.segments.find(
                          (candidate) =>
                            candidate.fromItemId === previous.id &&
                            candidate.toItemId === item.id,
                        ) ?? null)
                      : null;
                    return (
                      <li
                        key={item.id}
                        className="grid grid-cols-[64px_16px_minmax(0,1fr)] gap-3 py-5 sm:grid-cols-[76px_20px_minmax(0,1fr)_auto] sm:gap-4"
                      >
                        <time className="pt-0.5 text-sm font-semibold">
                          {item.plannedTime}
                        </time>
                        <div className="relative flex justify-center">
                          <span className="mt-1.5 size-2.5 rounded-full border-2 border-paper bg-brown-accent ring-1 ring-brown-accent" />
                          {index < later.length - 1 && (
                            <span className="absolute top-4 bottom-[-1.25rem] w-px bg-warm-border" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-editorial text-xl font-semibold tracking-[-0.02em]">
                            {item.place.name}
                          </h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-warm-muted">
                            <span>{item.estimatedDurationMinutes} min</span>
                            <WeatherLine
                              weather={weather.get(item.id) ?? null}
                            />
                          </div>
                        </div>
                        {segment && (
                          <span className="col-start-3 inline-flex items-center gap-1.5 text-xs text-warm-muted sm:col-start-auto sm:self-center">
                            <Navigation
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            {formatTravel(segment.durationSeconds)} travel
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </>
        ) : (
          <section className="rounded-2xl border border-warm-border bg-paper p-10 text-center shadow-editorial">
            <Clock3
              className="mx-auto size-6 text-brown-accent"
              aria-hidden="true"
            />
            <h2 className="mt-4 font-editorial text-3xl font-semibold">
              Day complete
            </h2>
            <p className="mt-2 text-sm text-warm-muted">
              All scheduled stops for today have passed.
            </p>
          </section>
        )}

        <section className="fixed inset-x-3 bottom-3 z-20 flex justify-center sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 lg:absolute lg:bottom-3">
          <div className="sr-only">
            <p className="text-xs font-bold tracking-[0.16em] text-paper/55">
              PLANS CAN CHANGE
            </p>
            <h2 className="mt-1 font-editorial text-2xl font-semibold tracking-[-0.03em]">
              Need to adjust the day?
            </h2>
          </div>
          <ChangeBar
            members={members}
            weatherContext={weatherContext}
            weatherDisruptions={weatherDisruptions}
            weatherAvailable={weatherAvailable}
            schedule={
              current
                ? { day: activeDay.day, current, later: remaining.slice(1) }
                : null
            }
            onScheduleApply={applyScheduleChange}
            onWeatherDelay={delayWeatherStop}
            onWeatherSkip={skipWeatherStop}
            onRainOverrideChange={setExplicitRainChangeActive}
          />
        </section>

        <details className="group mt-5 rounded-2xl border border-warm-border bg-paper shadow-editorial lg:hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 text-sm font-semibold marker:hidden sm:px-6">
            Full day weather timeline
            <span className="text-xs font-normal text-warm-muted group-open:hidden">
              Show
            </span>
            <span className="hidden text-xs font-normal text-warm-muted group-open:inline">
              Hide
            </span>
          </summary>
          <div className="border-t border-warm-border px-1 pb-1">
            <ActivityWeatherTimeline
              items={activeDay.items}
              route={route}
              weather={weather}
              nowMinutes={nowMinutes}
              isToday={tripDate === todayIso}
            />
          </div>
        </details>
      </div>
    </main>
  );
}
