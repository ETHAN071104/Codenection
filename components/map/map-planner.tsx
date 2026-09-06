'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CloudSun,
  GripVertical,
  MapPin,
  Plus,
  Route,
  Star,
  Trash2,
} from 'lucide-react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import {
  SystemLoading,
  SystemNotice,
  SystemState,
} from '@/components/ui/system-state';
import { AddPlacePanel } from '@/components/map/add-place-panel';
import { AiEditPanel } from '@/components/map/ai-edit-panel';
import { cn } from '@/lib/utils';
import { phase2Fetch } from '@/lib/phase2/client';
import type { ItineraryItemView, ItineraryPageData } from '@/lib/phase2/types';
import type { RouteSegment, TripRoute } from '@/lib/routing/types';
import type {
  PlannerMutationResponse,
  WeatherAtStop,
  WeatherDayResponse,
} from '@/lib/planner/types';
import {
  useTripRealtime,
  type TripRealtimeStatus,
} from '@/lib/realtime/use-trip-realtime';

type Screen = 'loading' | 'ready' | 'error';
type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';
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
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
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
      <div className="flex h-full min-h-[360px] items-center justify-center bg-[#e7e0cd] p-8 text-center text-warm-muted">
        <div className="max-w-sm rounded-2xl border border-warm-border bg-paper/95 p-6 shadow-editorial">
          <MapPin
            className="mx-auto size-6 text-brown-accent"
            aria-hidden="true"
          />
          <p className="mt-3 font-semibold text-ink">
            Map view is not available.
          </p>
          <p className="mt-2 text-sm leading-6">
            These stops do not have saved coordinates yet. Your itinerary is
            still available in the panel.
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
          color="#24201c"
          width={4}
          opacity={0.72}
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
                  'flex size-9 items-center justify-center rounded-full border-2 border-paper text-sm font-bold shadow-[0_6px_16px_rgb(55_43_34/28%)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent focus-visible:ring-offset-2',
                  selected
                    ? 'scale-125 bg-brown-accent text-paper'
                    : 'bg-ink text-paper hover:scale-110',
                )}
              >
                {index + 1}
              </button>
            </MarkerContent>
            <MarkerPopup closeButton>
              <div className="min-w-48 p-1 text-ink">
                <p className="font-semibold">{item.place.name}</p>
                <p className="mt-2 text-sm text-warm-muted">
                  {item.plannedTime} ·{' '}
                  {formatDuration(item.estimatedDurationMinutes)}
                </p>
                {item.place.rating !== null && (
                  <p className="mt-2 inline-flex items-center gap-1 text-sm text-ink">
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
  dragHandle,
  removeAction,
  weather,
}: {
  item: ItineraryItemView;
  index: number;
  selected: boolean;
  onSelect: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
  dragHandle: ReactNode;
  removeAction: ReactNode;
  weather: WeatherAtStop | null;
}) {
  return (
    <div
      className={cn(
        'group flex border-b border-warm-border/80 bg-white transition-colors',
        selected
          ? 'shadow-[inset_3px_0_0_#8c6b51] bg-[#fbf7f0]'
          : 'hover:bg-[#fcfaf6]',
      )}
    >
      {dragHandle}
      <button
        ref={cardRef}
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 py-4 pr-2 text-left text-ink outline-none focus-visible:ring-2 focus-visible:ring-brown-accent focus-visible:ring-inset sm:py-5"
        aria-pressed={selected}
        aria-label={`${index + 1}. ${item.place.name}, ${item.plannedTime}`}
      >
        <span className="flex items-start gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[0.65rem] font-semibold text-paper">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <time className="block text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-brown-accent">
              {item.plannedTime}
            </time>
            <span className="mt-1 block font-editorial text-[1.08rem] font-medium leading-snug tracking-[-0.02em] text-ink">
              {item.place.name}
            </span>
            <span className="mt-1.5 block text-xs font-medium text-warm-muted">
              {formatDuration(item.estimatedDurationMinutes)}
            </span>
            <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[0.7rem] leading-5 text-warm-muted">
              {item.place.rating !== null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3 fill-current" aria-hidden="true" />
                  {item.place.rating.toFixed(1)}
                </span>
              )}
              {weather && weather.temperatureC !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <CloudSun className="size-3.5" aria-hidden="true" />
                  {weather.condition}, {Math.round(weather.temperatureC)}°C
                  {weather.precipitationProbability !== null &&
                    `, ${Math.round(weather.precipitationProbability)}% rain`}
                </span>
              )}
            </span>
          </span>
        </span>
      </button>
      {removeAction}
    </div>
  );
}

function SortableItineraryCard({
  item,
  index,
  selected,
  onSelect,
  cardRef,
  segment,
  disabled,
  onRemove,
  weather,
}: {
  item: ItineraryItemView;
  index: number;
  selected: boolean;
  onSelect: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
  segment: RouteSegment | null;
  disabled: boolean;
  onRemove: () => void;
  weather: WeatherAtStop | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'relative',
        isDragging && 'z-20 opacity-70 shadow-[0_12px_32px_rgb(37_40_45/28%)]',
      )}
    >
      <ItineraryCard
        item={item}
        index={index}
        selected={selected}
        onSelect={onSelect}
        cardRef={cardRef}
        dragHandle={
          <button
            type="button"
            className="flex w-8 shrink-0 cursor-grab items-center justify-center text-warm-muted/45 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-brown-accent focus-visible:ring-inset active:cursor-grabbing disabled:cursor-default disabled:opacity-35 sm:w-9"
            aria-label={`Drag ${item.place.name}`}
            title="Drag to reorder"
            disabled={disabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        }
        removeAction={
          <button
            type="button"
            aria-label={`Remove ${item.place.name}`}
            title="Remove stop"
            disabled={disabled}
            onClick={onRemove}
            className="flex w-9 shrink-0 items-center justify-center text-warm-muted/45 outline-none transition-colors hover:text-[#a84a3f] focus-visible:ring-2 focus-visible:ring-brown-accent focus-visible:ring-inset disabled:opacity-35 sm:w-10"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        }
        weather={weather}
      />
      <TravelSegment segment={segment} />
    </div>
  );
}

function TravelSegment({ segment }: { segment: RouteSegment | null }) {
  if (!segment) return null;

  return (
    <div className="flex items-center gap-3 border-b border-warm-border/80 bg-parchment/55 px-10 py-2 text-[0.68rem] text-warm-muted">
      <span className="h-5 w-px bg-warm-border" aria-hidden="true" />
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
  const [isSaving, setIsSaving] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [addPlaceOpen, setAddPlaceOpen] = useState(false);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [weatherByItemId, setWeatherByItemId] = useState(
    new Map<string, WeatherAtStop>(),
  );
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] =
    useState<TripRealtimeStatus>('CONNECTING');
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const routeCache = useRef(new Map<string, TripRoute>());
  const routeRequests = useRef(new Map<string, Promise<TripRoute>>());
  const activeRouteKey = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  const refreshFromRealtime = useCallback(async () => {
    if (isSaving) return;
    try {
      const payload = await phase2Fetch<ItineraryPageData>(
        `/api/trips/${tripId}/itinerary`,
      );
      setData(payload);
      setSelectedDay((current) =>
        payload.itinerary?.days.some((day) => day.day === current)
          ? current
          : (payload.itinerary?.days[0]?.day ?? null),
      );
      setPlannerError(null);
    } catch {
      setPlannerError('Live updates paused. Refresh to reconnect.');
    }
  }, [isSaving, tripId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const days = data?.itinerary?.days ?? [];
  const activeDay =
    days.find((day) => day.day === selectedDay) ?? days[0] ?? null;
  const realtimeMembers = useTripRealtime({
    tripId,
    editingItemId: selectedItemId,
    onItineraryChange: refreshFromRealtime,
    onStatusChange: setRealtimeStatus,
  });
  const activeEditor = realtimeMembers.find((member) => member.editingItemId);
  const activeEditorPlace = activeEditor?.editingItemId
    ? days
        .flatMap((day) => day.items)
        .find((item) => item.id === activeEditor.editingItemId)?.place.name
    : null;
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
    if (!activeDay || isSaving) return;
    void Promise.resolve().then(() => loadRoute(activeDay));
  }, [activeDay, isSaving, loadRoute]);

  useEffect(() => {
    let cancelled = false;
    if (!activeDay) return;
    void Promise.resolve().then(() => {
      if (!cancelled) setWeatherStatus('loading');
    });
    phase2Fetch<WeatherDayResponse>(
      `/api/trips/${tripId}/weather?day=${activeDay.day}`,
    )
      .then((payload) => {
        if (!cancelled) {
          setWeatherByItemId(
            new Map(payload.stops.map((stop) => [stop.itemId, stop])),
          );
          setWeatherStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWeatherByItemId(new Map());
          setWeatherStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeDay, tripId]);

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

  function applyPlannerMutation(result: PlannerMutationResponse) {
    const updatedDay = result.data.itinerary?.days.find(
      (day) => day.day === result.day,
    );
    if (updatedDay) {
      const key = getRouteCacheKey(tripId, result.day, updatedDay.items);
      routeCache.current.set(key, result.route);
      activeRouteKey.current = key;
      setRouteState({ key, status: 'ready', route: result.route });
      setSelectedDay(result.day);
    }
    setData(result.data);
    setSelectedItemId(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (isSaving || !activeDay || !data) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const previousItems = activeDay.items;
    const fromIndex = previousItems.findIndex((item) => item.id === active.id);
    const toIndex = previousItems.findIndex((item) => item.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;

    const reorderedItems = arrayMove(previousItems, fromIndex, toIndex).map(
      (item, index) => ({ ...item, sortOrder: index }),
    );
    const oldRouteKey = getRouteCacheKey(tripId, activeDay.day, previousItems);

    setData((current) => {
      if (!current?.itinerary) return current;
      return {
        ...current,
        itinerary: {
          ...current.itinerary,
          days: current.itinerary.days.map((day) =>
            day.day === activeDay.day ? { ...day, items: reorderedItems } : day,
          ),
        },
      };
    });
    setSelectedItemId(null);
    setPlannerError(null);
    setIsSaving(true);

    try {
      const result = await phase2Fetch<PlannerMutationResponse>(
        `/api/trips/${tripId}/reorder`,
        {
          method: 'PUT',
          body: JSON.stringify({
            day: activeDay.day,
            itemIds: reorderedItems.map((item) => item.id),
          }),
        },
      );
      routeCache.current.delete(oldRouteKey);
      applyPlannerMutation(result);
    } catch (saveError) {
      setData((current) => {
        if (!current?.itinerary) return current;
        return {
          ...current,
          itinerary: {
            ...current.itinerary,
            days: current.itinerary.days.map((day) =>
              day.day === activeDay.day
                ? { ...day, items: previousItems }
                : day,
            ),
          },
        };
      });
      setPlannerError(
        saveError instanceof Error
          ? saveError.message
          : 'We could not save that itinerary order.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddPlace(externalPlaceId: string) {
    if (!activeDay || isSaving) return;
    setIsSaving(true);
    setPlannerError(null);
    try {
      const result = await phase2Fetch<PlannerMutationResponse>(
        `/api/trips/${tripId}/places`,
        {
          method: 'POST',
          body: JSON.stringify({
            day: activeDay.day,
            externalPlaceId,
          }),
        },
      );
      applyPlannerMutation(result);
    } catch (saveError) {
      setPlannerError(
        saveError instanceof Error
          ? saveError.message
          : 'We could not add that place.',
      );
      throw saveError;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemovePlace(item: ItineraryItemView) {
    if (isSaving) return;
    const confirmed = window.confirm(
      `Remove ${item.place.name} from this day?`,
    );
    if (!confirmed) return;

    setIsSaving(true);
    setPlannerError(null);
    try {
      const result = await phase2Fetch<PlannerMutationResponse>(
        `/api/trips/${tripId}/items`,
        { method: 'DELETE', body: JSON.stringify({ itemId: item.id }) },
      );
      applyPlannerMutation(result);
    } catch (saveError) {
      setPlannerError(
        saveError instanceof Error
          ? saveError.message
          : 'We could not remove that stop.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (screen === 'loading') {
    return (
      <AtlasShell tripId={tripId} sectionLabel="MAP PLAN">
        <SystemLoading
          title="Preparing your map"
          description="We’re loading the saved stops, day order, and route context."
        />
      </AtlasShell>
    );
  }

  if (screen === 'error' || !data) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="MAP PLAN">
        <SystemState
          role="alert"
          eyebrow="Map plan"
          title="We could not open your map plan."
          description={
            <>
              <p>{error}</p>
              <p className="mt-2">Your saved itinerary has not been changed.</p>
            </>
          }
          actions={
            <>
              <Button
                type="button"
                className="h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90"
                onClick={() => void load()}
              >
                Try again
              </Button>
              <Link
                href={`/trip/${tripId}`}
                className={buttonVariants({
                  variant: 'outline',
                  className:
                    'h-11 rounded-xl border-warm-border bg-paper px-5 text-ink hover:bg-parchment',
                })}
              >
                Back to trip room
              </Link>
            </>
          }
        />
      </AtlasShell>
    );
  }

  if (!data.itinerary || days.length === 0 || !activeDay) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="MAP PLAN">
        <SystemState
          eyebrow="Map plan"
          title="Your map is waiting for an itinerary."
          description="Nothing has gone wrong. Once the trip has saved places, they will appear here as markers and a route."
          actions={
            <Link
              href={`/trip/${tripId}/itinerary`}
              className={buttonVariants({
                className:
                  'h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90',
              })}
            >
              Go to Generate Trip
            </Link>
          }
        />
      </AtlasShell>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-parchment text-ink lg:h-[100dvh] lg:overflow-hidden">
      <header className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center border-b border-warm-border bg-white px-4 sm:px-6">
        <Link
          href={`/trip/${tripId}`}
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-brown-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-white"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Trip room
        </Link>
        <div className="text-center text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-warm-muted sm:text-xs">
          Map plan
        </div>
        <Link
          href={`/trip/${tripId}/itinerary`}
          className="justify-self-end text-xs font-semibold text-warm-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          Full itinerary
        </Link>
      </header>

      <div className="lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,7fr)_minmax(340px,3fr)]">
        <section
          aria-label={`${data.itinerary.destination} map`}
          className="relative h-[48dvh] min-h-[360px] overflow-hidden bg-[#e7e0cd] lg:h-full lg:min-h-0"
        >
          <MapCanvas
            items={activeDay.items}
            route={route}
            selectedItemId={selectedItemId}
            onSelect={selectItem}
          />
        </section>

        <aside className="relative z-10 -mt-5 flex min-h-[52dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-warm-border bg-white shadow-editorial lg:mt-0 lg:h-full lg:min-h-0 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none">
          <div className="border-b border-warm-border px-5 pb-5 pt-6 sm:px-6 lg:pt-7">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-brown-accent">
              Your itinerary
            </p>
            <div className="mt-2 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate font-editorial text-2xl font-medium tracking-[-0.035em] text-ink">
                  {data.itinerary.destination}
                </h1>
                <p className="mt-1 text-xs leading-5 text-warm-muted">
                  Day {activeDay.day} ·{' '}
                  {activeDay.theme.replace(/^Day\s+\d+:\s*/i, '')}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-parchment px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-muted">
                {days.length} {days.length === 1 ? 'day' : 'days'}
              </span>
            </div>
          </div>

          <div
            className="flex gap-2 overflow-x-auto border-b border-warm-border px-5 py-3 sm:px-6"
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
                    'h-8 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                    active
                      ? 'border-ink bg-ink text-paper'
                      : 'border-warm-border bg-parchment text-warm-muted hover:border-brown-accent/45 hover:text-ink',
                  )}
                >
                  Day {day.day}
                </button>
              );
            })}
          </div>

          <div className="border-b border-warm-border bg-[#fcfaf6] px-5 py-3 sm:px-6">
            <div className="flex items-center gap-2 text-xs text-warm-muted">
              <Route
                className="size-3.5 shrink-0 text-brown-accent"
                aria-hidden="true"
              />
              <span>
                {activeDay.items.length} stops
                {route && route.totalDistanceMeters > 0 && (
                  <>
                    {' · '}
                    {formatRouteDistance(route.totalDistanceMeters)} ·{' '}
                    {formatRouteDuration(route.totalDurationSeconds)} travel
                  </>
                )}
              </span>
            </div>
            {routeStatus === 'loading' && (
              <p className="mt-1.5 text-[0.68rem] text-warm-muted">
                Calculating route…
              </p>
            )}
            {routeStatus === 'error' && (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-brown-accent/25 bg-paper px-3 py-2 text-[0.68rem] text-ink">
                <span>
                  Route details are unavailable. Your stops are unchanged.
                </span>
                <button
                  type="button"
                  onClick={() => void loadRoute(activeDay)}
                  className="shrink-0 font-semibold text-brown-accent underline-offset-2 hover:underline"
                >
                  Retry
                </button>
              </div>
            )}
            {weatherStatus === 'error' && (
              <p className="mt-2 rounded-lg border border-brown-accent/25 bg-paper px-3 py-2 text-[0.68rem] leading-5 text-ink">
                Weather is unavailable right now. Your itinerary and route are
                still ready to use.
              </p>
            )}
            {isSaving && (
              <p className="mt-1.5 text-[0.68rem] text-warm-muted">
                Updating route and schedule…
              </p>
            )}
            {plannerError && (
              <SystemNotice
                role="alert"
                className="mt-2 px-3 py-2 text-[0.68rem]"
                title="That update didn’t save."
                description="Your previous itinerary is still saved. Refresh to restore the latest plan."
                actions={
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="font-semibold text-brown-accent underline-offset-2 hover:underline"
                  >
                    Refresh
                  </button>
                }
              />
            )}
            {!plannerError &&
              ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(
                realtimeStatus,
              ) && (
                <SystemNotice
                  className="mt-2 px-3 py-2"
                  title="Live updates are paused."
                  description="Your saved itinerary is safe. Refresh to reconnect and check for group changes."
                  actions={
                    <button
                      type="button"
                      onClick={() => void load()}
                      className="font-semibold text-brown-accent underline-offset-2 hover:underline"
                    >
                      Refresh
                    </button>
                  }
                />
              )}
            {activeEditor && activeEditorPlace && (
              <p className="mt-1.5 text-[0.68rem] font-medium text-ink">
                {activeEditor.displayName} is editing {activeEditorPlace}
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div role="tabpanel" aria-label={`Day ${activeDay.day} itinerary`}>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => void handleDragEnd(event)}
              >
                <SortableContext
                  items={activeDay.items.map((item) => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {activeDay.items.map((item, index) => {
                    const nextItem = activeDay.items[index + 1];
                    const segment = nextItem
                      ? (routeSegments.get(`${item.id}:${nextItem.id}`) ?? null)
                      : null;
                    return (
                      <SortableItineraryCard
                        key={item.id}
                        item={item}
                        index={index}
                        selected={item.id === selectedItemId}
                        onSelect={() => selectItem(item.id)}
                        cardRef={(element) => {
                          if (element) cardRefs.current.set(item.id, element);
                          else cardRefs.current.delete(item.id);
                        }}
                        segment={segment}
                        disabled={isSaving}
                        onRemove={() => void handleRemovePlace(item)}
                        weather={weatherByItemId.get(item.id) ?? null}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            </div>

            <div className="grid grid-cols-2 gap-2 border-b border-warm-border bg-[#fcfaf6] p-4 sm:px-5">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  setAiEditOpen((open) => !open);
                  setAddPlaceOpen(false);
                }}
                aria-expanded={aiEditOpen}
                aria-label="Adjust itinerary with AI"
                className={cn(
                  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brown-accent/40 disabled:opacity-45',
                  aiEditOpen
                    ? 'border-ink bg-ink text-paper'
                    : 'border-warm-border bg-white text-warm-muted hover:text-ink',
                )}
              >
                <Bot className="size-3.5" aria-hidden="true" />
                Adjust with AI
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  setAddPlaceOpen((open) => !open);
                  setAiEditOpen(false);
                }}
                aria-expanded={addPlaceOpen}
                className={cn(
                  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brown-accent/40 disabled:opacity-45',
                  addPlaceOpen
                    ? 'border-ink bg-ink text-paper'
                    : 'border-warm-border bg-white text-warm-muted hover:text-ink',
                )}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add place
              </button>
            </div>

            {addPlaceOpen && (
              <AddPlacePanel
                tripId={tripId}
                day={activeDay.day}
                disabled={isSaving}
                onAdd={handleAddPlace}
                onClose={() => setAddPlaceOpen(false)}
              />
            )}
            {aiEditOpen && (
              <AiEditPanel
                tripId={tripId}
                day={activeDay.day}
                disabled={isSaving}
                onApplied={(result) => applyPlannerMutation(result)}
                onApplyStateChange={setIsSaving}
                onClose={() => setAiEditOpen(false)}
              />
            )}
          </div>

          <div className="border-t border-warm-border bg-white p-4 sm:px-5">
            <Link
              href={`/trip/${tripId}/live`}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-paper shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              Start Live Trip
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
