'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock3, LoaderCircle, MapPin, Star } from 'lucide-react';
import { AtlasShell } from '@/components/travel-dna/atlas-shell';
import {
  Map as Mapcn,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  MarkerPopup,
  useMap,
} from '@/components/ui/map';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { phase2Fetch } from '@/lib/phase2/client';
import type { ItineraryItemView, ItineraryPageData } from '@/lib/phase2/types';
import type { RouteSegment, TripRoute } from '@/lib/routing/types';

type Screen = 'loading' | 'ready' | 'error';
type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
type RouteState = {
  key: string | null;
  status: RouteStatus;
  route: TripRoute | null;
};

function hasValidCoordinates(item: ItineraryItemView) {
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

function formatDuration(minutes: number) {
  return `${minutes} min`;
}

function formatRouteDistance(meters: number) {
  if (meters < 1_000) return `${Math.round(meters)} m`;
  return `${(meters / 1_000).toFixed(1)} km`;
}

function formatRouteDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function getRouteCacheKey(
  tripId: string,
  dayNumber: number,
  items: ItineraryItemView[],
) {
  return `${tripId}:${dayNumber}:${items
    .map(
      (item) =>
        `${item.id}:${item.place.longitude ?? 'missing'},${item.place.latitude ?? 'missing'}`,
    )
    .join('|')}`;
}

function MapDayViewport({ items }: { items: ItineraryItemView[] }) {
  const { map, isLoaded } = useMap();
  const validItems = useMemo(() => items.filter(hasValidCoordinates), [items]);

  useEffect(() => {
    if (!map || !isLoaded || validItems.length === 0) return;

    if (validItems.length === 1) {
      const item = validItems[0];
      map.easeTo({
        center: [item.place.longitude!, item.place.latitude!],
        zoom: 13,
        duration: 550,
      });
      return;
    }

    const longitudes = validItems.map((item) => item.place.longitude!);
    const latitudes = validItems.map((item) => item.place.latitude!);
    map.fitBounds(
      [
        [Math.min(...longitudes), Math.min(...latitudes)],
        [Math.max(...longitudes), Math.max(...latitudes)],
      ],
      {
        padding: { top: 88, right: 88, bottom: 88, left: 88 },
        maxZoom: 14,
        duration: 550,
      },
    );
  }, [isLoaded, map, validItems]);

  return null;
}

function MapCanvas({
  items,
  route,
  selectedItemId,
  onSelect,
}: {
  items: ItineraryItemView[];
  route: TripRoute | null;
  selectedItemId: string | null;
  onSelect: (itemId: string, scrollToCard?: boolean) => void;
}) {
  const validItems = items.filter(hasValidCoordinates);
  const initialItem = validItems[0];

  if (!initialItem) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center bg-[#e7e0cd] p-8 text-center text-[#5a5d61]">
        <div>
          <MapPin
            className="mx-auto size-6 text-[#2f3237]"
            aria-hidden="true"
          />
          <p className="mt-3 font-semibold text-[#25282d]">Map unavailable</p>
          <p className="mt-2 text-sm leading-6">
            This itinerary has no valid saved coordinates yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Mapcn
      center={[initialItem.place.longitude!, initialItem.place.latitude!]}
      zoom={12}
      theme="light"
      className="h-full min-h-[360px]"
    >
      <MapDayViewport items={items} />
      {route?.geometry && (
        <MapRoute
          id="saved-driving-route"
          coordinates={route.geometry.coordinates}
          color="#2f3237"
          width={4}
          opacity={0.78}
          interactive={false}
        />
      )}
      <MapControls />
      {validItems.map((item, index) => {
        const selected = item.id === selectedItemId;
        return (
          <MapMarker
            key={item.id}
            longitude={item.place.longitude!}
            latitude={item.place.latitude!}
            onClick={() => onSelect(item.id, true)}
          >
            <MarkerContent>
              <button
                type="button"
                aria-label={`${index + 1}. ${item.place.name}`}
                className={cn(
                  'flex size-9 items-center justify-center rounded-full border-2 border-[#f8f4e8] text-sm font-bold shadow-[0_6px_16px_rgb(37_40_45/35%)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3237] focus-visible:ring-offset-2',
                  selected
                    ? 'scale-125 bg-[#1f2227] text-[#f8f4e8]'
                    : 'bg-[#2f3237] text-[#f8f4e8] hover:scale-110',
                )}
              >
                {index + 1}
              </button>
            </MarkerContent>
            <MarkerPopup closeButton>
              <div className="min-w-48 p-1 text-[#25282d]">
                <p className="font-semibold">{item.place.name}</p>
                <p className="mt-2 text-sm text-[#5a5d61]">
                  {item.plannedTime} ·{' '}
                  {formatDuration(item.estimatedDurationMinutes)}
                </p>
                {item.place.rating !== null && (
                  <p className="mt-2 inline-flex items-center gap-1 text-sm text-[#2f3237]">
                    <Star
                      className="size-3.5 fill-current"
                      aria-hidden="true"
                    />
                    {item.place.rating.toFixed(1)} Google rating
                  </p>
                )}
              </div>
            </MarkerPopup>
          </MapMarker>
        );
      })}
    </Mapcn>
  );
}

function ItineraryCard({
  item,
  index,
  selected,
  onSelect,
  cardRef,
}: {
  item: ItineraryItemView;
  index: number;
  selected: boolean;
  onSelect: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full border-b border-[#35383d]/20 p-5 text-left outline-none transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:ring-[#2f3237] focus-visible:ring-inset',
        selected
          ? 'bg-[#2f3237] text-[#f8f4e8]'
          : 'bg-[#f7f3e8] hover:bg-[#e7e0cd]',
      )}
      aria-pressed={selected}
      aria-label={`${index + 1}. ${item.place.name}, ${item.plannedTime}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            selected
              ? 'bg-[#f8f4e8] text-[#2f3237]'
              : 'bg-[#2f3237] text-[#f8f4e8]',
          )}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">{item.place.name}</span>
            <time
              className={cn(
                'shrink-0 text-xs font-medium',
                selected ? 'text-[#f8f4e8]/75' : 'text-[#5a5d61]',
              )}
            >
              {item.plannedTime}
            </time>
          </span>
          <span
            className={cn(
              'mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs',
              selected ? 'text-[#f8f4e8]/80' : 'text-[#5a5d61]',
            )}
          >
            {item.place.rating !== null && (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3 fill-current" aria-hidden="true" />
                {item.place.rating.toFixed(1)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3" aria-hidden="true" />
              {formatDuration(item.estimatedDurationMinutes)}
            </span>
          </span>
        </span>
      </div>
    </button>
  );
}

function TravelSegment({ segment }: { segment: RouteSegment | null }) {
  if (!segment) return null;

  return (
    <div className="flex items-center gap-3 border-b border-[#35383d]/20 bg-[#f2eee1] px-5 py-3 text-xs text-[#5a5d61]">
      <span
        className="text-base leading-none text-[#2f3237]"
        aria-hidden="true"
      >
        ↓
      </span>
      <span>
        {formatRouteDuration(segment.durationSeconds)} ·{' '}
        {formatRouteDistance(segment.distanceMeters)}
      </span>
    </div>
  );
}

export function MapPlanner({ tripId }: { tripId: string }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [data, setData] = useState<ItineraryPageData | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [routeState, setRouteState] = useState<RouteState>({
    key: null,
    status: 'idle',
    route: null,
  });
  const [error, setError] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const routeCache = useRef(new Map<string, TripRoute>());
  const routeRequests = useRef(new Map<string, Promise<TripRoute>>());
  const activeRouteKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setScreen('loading');
    setError(null);
    try {
      const payload = await phase2Fetch<ItineraryPageData>(
        `/api/trips/${tripId}/itinerary`,
      );
      setData(payload);
      setSelectedDay(payload.itinerary?.days[0]?.day ?? null);
      setSelectedItemId(null);
      setScreen('ready');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'We could not load this map plan.',
      );
      setScreen('error');
    }
  }, [tripId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const days = data?.itinerary?.days ?? [];
  const activeDay =
    days.find((day) => day.day === selectedDay) ?? days[0] ?? null;
  const routeKey = activeDay
    ? getRouteCacheKey(tripId, activeDay.day, activeDay.items)
    : null;

  const loadRoute = useCallback(
    async (day: { day: number; items: ItineraryItemView[] }) => {
      const key = getRouteCacheKey(tripId, day.day, day.items);
      activeRouteKey.current = key;

      const validItemCount = day.items.filter(hasValidCoordinates).length;
      if (validItemCount < 2) {
        const emptyRoute: TripRoute = {
          geometry: null,
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          segments: [],
        };
        routeCache.current.set(key, emptyRoute);
        setRouteState({ key, status: 'ready', route: emptyRoute });
        return;
      }

      const cached = routeCache.current.get(key);
      if (cached) {
        setRouteState({ key, status: 'ready', route: cached });
        return;
      }

      setRouteState({ key, status: 'loading', route: null });
      let request = routeRequests.current.get(key);
      if (!request) {
        request = phase2Fetch<TripRoute>(
          `/api/trips/${tripId}/route?day=${day.day}`,
        );
        routeRequests.current.set(key, request);
      }

      try {
        const route = await request;
        routeCache.current.set(key, route);
        if (activeRouteKey.current === key) {
          setRouteState({ key, status: 'ready', route });
        }
      } catch {
        if (activeRouteKey.current === key) {
          setRouteState({ key, status: 'error', route: null });
        }
      } finally {
        routeRequests.current.delete(key);
      }
    },
    [tripId],
  );

  useEffect(() => {
    if (!activeDay) return;
    void Promise.resolve().then(() => loadRoute(activeDay));
  }, [activeDay, loadRoute]);

  const route = routeState.key === routeKey ? routeState.route : null;
  const routeStatus = routeState.key === routeKey ? routeState.status : 'idle';
  const routeSegments = useMemo(
    () =>
      new Map(
        (route?.segments ?? []).map((segment) => [
          `${segment.fromItemId}:${segment.toItemId}`,
          segment,
        ]),
      ),
    [route],
  );

  function selectItem(itemId: string, scrollToCard = false) {
    setSelectedItemId(itemId);
    if (scrollToCard) {
      window.requestAnimationFrame(() => {
        cardRefs.current.get(itemId)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      });
    }
  }

  if (screen === 'loading') {
    return (
      <AtlasShell tripId={tripId} sectionLabel="MAP PLAN">
        <div className="mx-auto flex items-center gap-3 text-[#5a5d61]">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Loading saved itinerary places
        </div>
      </AtlasShell>
    );
  }

  if (screen === 'error' || !data) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="MAP PLAN">
        <section className="mx-auto w-full max-w-xl border border-[#35383d]/35 bg-[#fffdf8] p-6 sm:p-9">
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">
            Map plan unavailable
          </h1>
          <p className="mt-4 leading-7 text-[#5a5d61]">{error}</p>
          <Button
            type="button"
            className="mt-7 h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
            onClick={() => void load()}
          >
            Try again
          </Button>
        </section>
      </AtlasShell>
    );
  }

  if (!data.itinerary || days.length === 0 || !activeDay) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="MAP PLAN">
        <section className="mx-auto w-full max-w-xl border border-[#35383d]/35 bg-[#fffdf8] p-6 sm:p-9">
          <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
            MAP FOUNDATION
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            Generate an itinerary first
          </h1>
          <p className="mt-4 leading-7 text-[#5a5d61]">
            Once your saved itinerary contains real places, they will appear
            here as map markers.
          </p>
          <Link
            href={`/trip/${tripId}/itinerary`}
            className={buttonVariants({
              className:
                'mt-7 h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]',
            })}
          >
            Go to Generate Trip
          </Link>
        </section>
      </AtlasShell>
    );
  }

  return (
    <AtlasShell tripId={tripId} sectionLabel="MAP PLAN">
      <section className="w-full py-2">
        <div className="mb-6 flex flex-col gap-4 border-b border-[#35383d]/30 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
              SAVED ITINERARY MAP
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              {data.itinerary.destination}
            </h1>
          </div>
          <Link
            href={`/trip/${tripId}/itinerary`}
            className="text-sm font-semibold text-[#2f3237] underline-offset-4 hover:underline"
          >
            View full itinerary
          </Link>
        </div>

        <div
          className="mb-5 flex flex-wrap gap-2"
          role="tablist"
          aria-label="Itinerary days"
        >
          {days.map((day) => {
            const active = day.day === activeDay.day;
            return (
              <button
                key={day.day}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setSelectedDay(day.day);
                  setSelectedItemId(null);
                }}
                className={cn(
                  'h-10 border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3237] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f2eee1]',
                  active
                    ? 'border-[#2f3237] bg-[#2f3237] text-[#f8f4e8]'
                    : 'border-[#35383d]/35 bg-[#f7f3e8] text-[#25282d] hover:bg-[#e7e0cd]',
                )}
              >
                Day {day.day}
              </button>
            );
          })}
        </div>

        <div className="grid overflow-hidden border border-[#35383d]/30 bg-[#35383d]/30 lg:grid-cols-[minmax(0,7fr)_minmax(288px,3fr)]">
          <div className="min-h-[420px] bg-[#e7e0cd] lg:min-h-[calc(100dvh-245px)]">
            <MapCanvas
              items={activeDay.items}
              route={route}
              selectedItemId={selectedItemId}
              onSelect={selectItem}
            />
          </div>
          <aside className="max-h-[45dvh] overflow-y-auto bg-[#f7f3e8] lg:max-h-[calc(100dvh-245px)]">
            <div className="sticky top-0 z-10 border-b border-[#35383d]/20 bg-[#f7f3e8] px-5 py-4">
              <p className="text-xs font-semibold tracking-[0.1em] text-[#2f3237]">
                DAY {activeDay.day}
              </p>
              <h2 className="mt-1 font-semibold">{activeDay.theme}</h2>
              <p className="mt-1 text-xs text-[#5a5d61]">
                {activeDay.items.length} stops
                {route && route.totalDistanceMeters > 0 && (
                  <>
                    {' · '}
                    {formatRouteDistance(route.totalDistanceMeters)} ·{' '}
                    {formatRouteDuration(route.totalDurationSeconds)} travel
                  </>
                )}
              </p>
              {routeStatus === 'loading' && (
                <p className="mt-2 text-xs text-[#5a5d61]">
                  Calculating route…
                </p>
              )}
              {routeStatus === 'error' && (
                <p className="mt-2 text-xs text-[#a84a3f]">Route unavailable</p>
              )}
            </div>
            <div role="tabpanel" aria-label={`Day ${activeDay.day} itinerary`}>
              {activeDay.items.map((item, index) => {
                const nextItem = activeDay.items[index + 1];
                const segment = nextItem
                  ? (routeSegments.get(`${item.id}:${nextItem.id}`) ?? null)
                  : null;
                return (
                  <div key={item.id}>
                    <ItineraryCard
                      item={item}
                      index={index}
                      selected={item.id === selectedItemId}
                      onSelect={() => selectItem(item.id)}
                      cardRef={(element) => {
                        if (element) cardRefs.current.set(item.id, element);
                        else cardRefs.current.delete(item.id);
                      }}
                    />
                    <TravelSegment segment={segment} />
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </section>
    </AtlasShell>
  );
}
