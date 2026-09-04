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
  Bot,
  CloudSun,
  Clock3,
  GripVertical,
  LoaderCircle,
  MapPin,
  Play,
  Plus,
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
import { useTripRealtime } from '@/lib/realtime/use-trip-realtime';

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
        'flex border-b border-[#35383d]/20 transition-colors',
        selected
          ? 'bg-[#2f3237] text-[#f8f4e8]'
          : 'bg-[#f7f3e8] hover:bg-[#e7e0cd]',
      )}
    >
      {dragHandle}
      <button
        ref={cardRef}
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#2f3237] focus-visible:ring-inset"
        aria-pressed={selected}
        aria-label={`${index + 1}. ${item.place.name}, ${item.plannedTime}`}
      >
        <span className="flex items-start gap-3">
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
            {weather && weather.temperatureC !== null && (
              <span
                className={cn(
                  'mt-2 inline-flex items-center gap-1.5 text-xs',
                  selected ? 'text-[#f8f4e8]/80' : 'text-[#5a5d61]',
                )}
              >
                <CloudSun className="size-3.5" aria-hidden="true" />
                {weather.condition}, {Math.round(weather.temperatureC)}°C
                {weather.precipitationProbability !== null &&
                  `, ${Math.round(weather.precipitationProbability)}% rain`}
              </span>
            )}
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
            className="flex w-9 shrink-0 cursor-grab items-center justify-center text-[#5a5d61] outline-none hover:text-[#2f3237] focus-visible:ring-2 focus-visible:ring-[#2f3237] focus-visible:ring-inset active:cursor-grabbing disabled:cursor-default disabled:opacity-45"
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
            className={cn(
              'flex w-10 shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#2f3237] focus-visible:ring-inset disabled:opacity-45',
              selected
                ? 'text-[#f8f4e8]/70 hover:text-[#f8f4e8]'
                : 'text-[#5a5d61] hover:text-[#a84a3f]',
            )}
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
  const [isSaving, setIsSaving] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [addPlaceOpen, setAddPlaceOpen] = useState(false);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [weatherByItemId, setWeatherByItemId] = useState(
    new Map<string, WeatherAtStop>(),
  );
  const [error, setError] = useState<string | null>(null);
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
    phase2Fetch<WeatherDayResponse>(
      `/api/trips/${tripId}/weather?day=${activeDay.day}`,
    )
      .then((payload) => {
        if (!cancelled) {
          setWeatherByItemId(
            new Map(payload.stops.map((stop) => [stop.itemId, stop])),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setWeatherByItemId(new Map());
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
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href={`/trip/${tripId}/itinerary`}
              className="text-sm font-semibold text-[#2f3237] underline-offset-4 hover:underline"
            >
              View full itinerary
            </Link>
            <Link
              href={`/trip/${tripId}/live`}
              className={buttonVariants({
                className:
                  'h-10 rounded-none bg-[#2f3237] px-4 text-[#f8f4e8] hover:bg-[#1f2227]',
              })}
            >
              <Play className="size-4" aria-hidden="true" />
              Start Live Trip
            </Link>
          </div>
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-[0.1em] text-[#2f3237]">
                    DAY {activeDay.day}
                  </p>
                  <h2 className="mt-1 font-semibold">{activeDay.theme}</h2>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setAiEditOpen((open) => !open);
                      setAddPlaceOpen(false);
                    }}
                    aria-expanded={aiEditOpen}
                    className="inline-flex size-9 items-center justify-center border border-[#35383d]/40 bg-[#fffdf8] outline-none hover:bg-[#e7e0cd] focus-visible:ring-2 focus-visible:ring-[#2f3237] disabled:opacity-45"
                    aria-label="Open AI itinerary editor"
                    title="AI itinerary editor"
                  >
                    <Bot className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setAddPlaceOpen((open) => !open);
                      setAiEditOpen(false);
                    }}
                    aria-expanded={addPlaceOpen}
                    className="inline-flex h-9 items-center gap-1.5 border border-[#35383d]/40 bg-[#fffdf8] px-3 text-xs font-semibold outline-none hover:bg-[#e7e0cd] focus-visible:ring-2 focus-visible:ring-[#2f3237] disabled:opacity-45"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Add Place
                  </button>
                </div>
              </div>
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
              {isSaving && (
                <p className="mt-2 text-xs text-[#5a5d61]">
                  Updating route and schedule...
                </p>
              )}
              {plannerError && (
                <p className="mt-2 text-xs text-[#a84a3f]">{plannerError}</p>
              )}
              {activeEditor && activeEditorPlace && (
                <p className="mt-2 text-xs font-medium text-[#2f3237]">
                  {activeEditor.displayName} is editing {activeEditorPlace}
                </p>
              )}
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
          </aside>
        </div>
      </section>
    </AtlasShell>
  );
}
