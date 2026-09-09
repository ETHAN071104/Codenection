'use client';

import {
  Fragment,
  type ReactNode,
  type RefObject,
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
  PlaneLanding,
  PlaneTakeoff,
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
import type { TripEndpoint } from '@/lib/trips/travel-boundaries';
import {
  ARRIVAL_ENDPOINT_ID,
  DEPARTURE_ENDPOINT_ID,
} from '@/lib/routing/route-points-core';
import type { RouteSegment, TripRoute } from '@/lib/routing/types';
import type {
  PlannerMutationResponse,
  WeatherAtStop,
  WeatherDayResponse,
} from '@/lib/planner/types';
import {
  nextAiPanelState,
  routeColorForDay,
  visibleRouteDayNumbers,
  type MapDaySelection,
} from '@/lib/planner/map-view-core';
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
  endpoints?: { arrival?: TripEndpoint | null; departure?: TripEndpoint | null },
) {
  const endpointKey = [
    endpoints?.arrival
      ? `arrival:${endpoints.arrival.googlePlaceId}:${endpoints.arrival.longitude},${endpoints.arrival.latitude}`
      : '',
    endpoints?.departure
      ? `departure:${endpoints.departure.googlePlaceId}:${endpoints.departure.longitude},${endpoints.departure.latitude}`
      : '',
  ].join('|');
  return `${tripId}:${dayNumber}:${endpointKey}:${items
    .map(
      (item) =>
        `${item.id}:${item.place.longitude ?? 'missing'},${item.place.latitude ?? 'missing'}`,
    )
    .join('|')}`;
}

function getDayEndpoints(
  data: ItineraryPageData | null,
  dayNumber: number,
) {
  const days = data?.itinerary?.days ?? [];
  return {
    arrival:
      dayNumber === days[0]?.day ? (data?.trip.arrivalPoint ?? null) : null,
    departure:
      dayNumber === days.at(-1)?.day
        ? (data?.trip.departurePoint ?? null)
        : null,
  };
}

function MapDayViewport({
  items,
  arrivalPoint,
  departurePoint,
}: {
  items: ItineraryItemView[];
  arrivalPoint: TripEndpoint | null;
  departurePoint: TripEndpoint | null;
}) {
  const { map, isLoaded } = useMap();
  const coordinates = useMemo(
    () => [
      ...(arrivalPoint
        ? [{ longitude: arrivalPoint.longitude, latitude: arrivalPoint.latitude }]
        : []),
      ...items.filter(hasValidCoordinates).map((item) => ({
        longitude: item.place.longitude!,
        latitude: item.place.latitude!,
      })),
      ...(departurePoint
        ? [{ longitude: departurePoint.longitude, latitude: departurePoint.latitude }]
        : []),
    ],
    [arrivalPoint, departurePoint, items],
  );

  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0) return;

    if (coordinates.length === 1) {
      const point = coordinates[0];
      map.easeTo({
        center: [point.longitude, point.latitude],
        zoom: 13,
        duration: 550,
      });
      return;
    }

    const longitudes = coordinates.map((point) => point.longitude);
    const latitudes = coordinates.map((point) => point.latitude);
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
  }, [coordinates, isLoaded, map]);

  return null;
}

function EditorialBasemapStyle() {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    type EditorialPaintProperty =
      | 'background-color'
      | 'fill-color'
      | 'fill-opacity'
      | 'fill-outline-color'
      | 'line-color'
      | 'line-opacity'
      | 'text-color'
      | 'text-halo-color'
      | 'text-halo-width'
      | 'text-opacity'
      | 'icon-color'
      | 'icon-opacity';

    const setPaint = (
      layerId: string,
      property: EditorialPaintProperty,
      value: string | number,
    ) => {
      if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value);
    };
    const layers = map.getStyle().layers ?? [];

    for (const layer of layers) {
      const { id, type } = layer;

      if (id === 'background') {
        setPaint(id, 'background-color', '#f5f3ed');
        continue;
      }

      if (type === 'fill') {
        if (id === 'water') {
          setPaint(id, 'fill-color', '#c8e5ec');
          setPaint(id, 'fill-opacity', 0.98);
        }
        else if (id === 'water_shadow') {
          setPaint(id, 'fill-color', '#b8d9e2');
          setPaint(id, 'fill-opacity', 0.72);
        } else if (id.includes('park') || id === 'landcover') {
          setPaint(id, 'fill-color', '#cfe4c4');
          setPaint(id, 'fill-opacity', 0.96);
        } else if (id === 'landuse') {
          setPaint(id, 'fill-color', '#deead6');
          setPaint(id, 'fill-opacity', 0.82);
        } else if (id === 'landuse_residential') {
          setPaint(id, 'fill-color', '#eee9e1');
          setPaint(id, 'fill-opacity', 0.82);
        } else if (id.startsWith('building')) {
          setPaint(id, 'fill-color', id === 'building-top' ? '#eeeae3' : '#e4dfd7');
          setPaint(id, 'fill-outline-color', '#dcd5cb');
        }
      }

      if (type === 'line') {
        if (id === 'waterway') {
          setPaint(id, 'line-color', '#a9d3df');
          setPaint(id, 'line-opacity', 0.95);
        } else if (id.includes('boundary')) {
          setPaint(id, 'line-color', '#c8c0b5');
          setPaint(id, 'line-opacity', 0.55);
        } else if (id.includes('rail')) {
          setPaint(id, 'line-color', '#c4bcb1');
          setPaint(id, 'line-opacity', 0.58);
        } else if (id.includes('_case')) {
          setPaint(id, 'line-color', '#cbc4b9');
          setPaint(id, 'line-opacity', 0.72);
        } else if (id.includes('_fill')) {
          const isHighway = id.includes('_mot_') || id.includes('_trunk_');
          const isPrimary = id.includes('_pri_') || id.includes('_sec_');
          setPaint(
            id,
            'line-color',
            isHighway ? '#e1cfa8' : isPrimary ? '#e4dac4' : '#f0ece5',
          );
          setPaint(id, 'line-opacity', 0.96);
        } else if (id.includes('path')) {
          setPaint(id, 'line-color', '#d9d3ca');
          setPaint(id, 'line-opacity', 0.78);
        }
      }

      if (type === 'symbol') {
        const isPlaceLabel = id.startsWith('place_');
        const isRoadLabel = id.startsWith('roadname_');
        setPaint(id, 'text-color', isPlaceLabel ? '#665f56' : '#756d63');
        setPaint(id, 'text-halo-color', '#f5f2eb');
        setPaint(id, 'text-halo-width', isRoadLabel ? 1.15 : 1.35);
        setPaint(id, 'icon-color', '#887f74');
        if (id.startsWith('poi_')) {
          setPaint(id, 'text-opacity', 0.78);
          setPaint(id, 'icon-opacity', 0.72);
        }
      }
    }
  }, [isLoaded, map]);

  return null;
}

function MapCanvas({
  items,
  routes,
  arrivalPoint,
  departurePoint,
  selectedItemId,
  onSelect,
}: {
  items: ItineraryItemView[];
  routes: { day: number; route: TripRoute; color: string }[];
  arrivalPoint: TripEndpoint | null;
  departurePoint: TripEndpoint | null;
  selectedItemId: string | null;
  onSelect: (itemId: string, scrollToCard?: boolean) => void;
}) {
  const validItems = items.filter(hasValidCoordinates);
  const sameEndpoint =
    arrivalPoint !== null &&
    departurePoint?.googlePlaceId === arrivalPoint.googlePlaceId;
  const initialPoint = arrivalPoint
    ? { longitude: arrivalPoint.longitude, latitude: arrivalPoint.latitude }
    : validItems[0]
      ? {
          longitude: validItems[0].place.longitude!,
          latitude: validItems[0].place.latitude!,
        }
      : departurePoint
        ? { longitude: departurePoint.longitude, latitude: departurePoint.latitude }
        : null;

  if (!initialPoint) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center bg-warm-border p-8 text-center text-warm-muted">
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
      center={[initialPoint.longitude, initialPoint.latitude]}
      zoom={12}
      theme="light"
      className="h-full min-h-[360px]"
    >
      <MapDayViewport
        items={items}
        arrivalPoint={arrivalPoint}
        departurePoint={departurePoint}
      />
      <EditorialBasemapStyle />
      {routes.map(({ day, route, color }) =>
        route.geometry ? (
          <Fragment key={day}>
            <MapRoute
              id={`saved-driving-route-outline-day-${day}`}
              coordinates={route.geometry.coordinates}
              color="#fff9ef"
              width={7}
              opacity={0.88}
              interactive={false}
            />
            <MapRoute
              id={`saved-driving-route-day-${day}`}
              coordinates={route.geometry.coordinates}
              color={color}
              width={4.5}
              opacity={0.94}
              interactive={false}
            />
          </Fragment>
        ) : null,
      )}
      <MapControls />
      {arrivalPoint && (
        <MapMarker
          longitude={arrivalPoint.longitude}
          latitude={arrivalPoint.latitude}
        >
          <MarkerContent>
            <div
              className="flex size-10 items-center justify-center rounded-full border-2 border-paper bg-brown-accent text-paper shadow-[0_6px_16px_rgb(55_43_34/28%)]"
              aria-label={`${sameEndpoint ? 'Arrival and departure' : 'Arrival'} point: ${arrivalPoint.name}`}
            >
              <PlaneLanding className="size-4" aria-hidden="true" />
            </div>
          </MarkerContent>
          <MarkerPopup closeButton>
            <div className="min-w-48 p-1 text-ink">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brown-accent">{sameEndpoint ? 'Arrival and departure point' : 'Arrival point'}</p>
              <p className="mt-1 font-semibold">{arrivalPoint.name}</p>
              {arrivalPoint.address && <p className="mt-2 text-sm text-warm-muted">{arrivalPoint.address}</p>}
            </div>
          </MarkerPopup>
        </MapMarker>
      )}
      {departurePoint && !sameEndpoint && (
        <MapMarker
          longitude={departurePoint.longitude}
          latitude={departurePoint.latitude}
        >
          <MarkerContent>
            <div
              className="flex size-10 items-center justify-center rounded-full border-2 border-paper bg-ink text-paper shadow-[0_6px_16px_rgb(55_43_34/28%)]"
              aria-label={`Departure point: ${departurePoint.name}`}
            >
              <PlaneTakeoff className="size-4" aria-hidden="true" />
            </div>
          </MarkerContent>
          <MarkerPopup closeButton>
            <div className="min-w-48 p-1 text-ink">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brown-accent">Departure point</p>
              <p className="mt-1 font-semibold">{departurePoint.name}</p>
              {departurePoint.address && <p className="mt-2 text-sm text-warm-muted">{departurePoint.address}</p>}
            </div>
          </MarkerPopup>
        </MapMarker>
      )}
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
                  'flex size-9 items-center justify-center rounded-full border-2 border-paper text-sm font-bold text-paper shadow-[0_6px_16px_rgb(55_43_34/28%)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent focus-visible:ring-offset-2',
                  selected
                    ? 'scale-125'
                    : 'hover:scale-110',
                )}
                style={{ backgroundColor: '#724a2d' }}
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

function PlaceThumbnail({
  tripId,
  item,
}: {
  tripId: string;
  item: ItineraryItemView;
}) {
  const [failed, setFailed] = useState(false);
  const photoName = item.place.photo?.name ?? null;
  const googlePlaceId = item.place.externalPlaceId;

  if (failed || (!photoName && !googlePlaceId)) return null;

  const search = new URLSearchParams();
  if (photoName) search.set('name', photoName);
  if (googlePlaceId) search.set('googlePlaceId', googlePlaceId);

  return (
    <span className="relative hidden h-[76px] w-[86px] shrink-0 overflow-hidden rounded-[0.65rem] border border-white/70 bg-white/35 shadow-[0_6px_18px_rgb(61_48_35/12%)] sm:block">
      <img
        src={`/api/trips/${encodeURIComponent(tripId)}/place-photo?${search.toString()}`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

function ItineraryCard({
  tripId,
  item,
  index,
  selected,
  onSelect,
  cardRef,
  dragHandle,
  removeAction,
  weather,
}: {
  tripId: string;
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
        'group relative flex border-b border-warm-border/50 bg-transparent transition-colors before:pointer-events-none before:absolute before:bottom-0 before:left-[50px] before:top-0 before:border-l before:border-dashed before:border-[#8b684b]/24',
        selected
          ? 'bg-white/42 shadow-[inset_3px_0_0_#755138]'
          : 'hover:bg-white/30',
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
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-[#fff8eb] bg-[#724a2d] text-[0.67rem] font-semibold text-[#fffaf1] shadow-[0_4px_12px_rgb(73_48_30/20%)]">
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
          <PlaceThumbnail tripId={tripId} item={item} />
        </span>
      </button>
      {removeAction}
    </div>
  );
}

function SortableItineraryCard({
  tripId,
  item,
  index,
  selected,
  onSelect,
  cardRef,
  segment,
  disabled,
  editable,
  onRemove,
  weather,
}: {
  tripId: string;
  item: ItineraryItemView;
  index: number;
  selected: boolean;
  onSelect: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
  segment: RouteSegment | null;
  disabled: boolean;
  editable: boolean;
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
        tripId={tripId}
        item={item}
        index={index}
        selected={selected}
        onSelect={onSelect}
        cardRef={cardRef}
        dragHandle={
          editable ? (
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
          ) : (
            <span className="w-8 shrink-0 sm:w-9" aria-hidden="true" />
          )
        }
        removeAction={
          editable ? (
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
          ) : null
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
    <div className="flex items-center gap-3 border-b border-warm-border/60 bg-white/16 px-10 py-2 text-[0.68rem] text-warm-muted">
      <span className="h-5 w-px bg-warm-border" aria-hidden="true" />
      <span>
        {formatRouteDuration(segment.durationSeconds)} ·{' '}
        {formatRouteDistance(segment.distanceMeters)}
      </span>
    </div>
  );
}

function AllDaysItinerary({
  tripId,
  days,
  selectedItemId,
  onSelect,
  cardRefs,
}: {
  tripId: string;
  days: NonNullable<ItineraryPageData['itinerary']>['days'];
  selectedItemId: string | null;
  onSelect: (itemId: string) => void;
  cardRefs: RefObject<Map<string, HTMLButtonElement>>;
}) {
  return (
    <div role="tabpanel" aria-label="Full itinerary across all days">
      {days.map((day) => (
        <section key={day.day} aria-labelledby={`all-day-${day.day}`}>
          <div className="flex items-center gap-3 border-b border-warm-border/65 bg-white/24 px-5 py-3 sm:px-6">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: routeColorForDay(day.day) }}
              aria-hidden="true"
            />
            <h2
              id={`all-day-${day.day}`}
              className="font-editorial text-base font-medium text-ink"
            >
              Day {day.day}
            </h2>
            <span className="truncate text-xs text-warm-muted">
              {day.theme.replace(/^Day\s+\d+:\s*/i, '')}
            </span>
          </div>
          <ol>
            {day.items.map((item, index) => (
              <li
                key={item.id}
                className={cn(
                  'border-b border-warm-border/65 bg-transparent',
                  selectedItemId === item.id &&
                    'bg-white/42 shadow-[inset_3px_0_0_#755138]',
                )}
              >
                <button
                  ref={(element) => {
                    if (element) cardRefs.current.set(item.id, element);
                    else cardRefs.current.delete(item.id);
                  }}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="flex w-full items-start gap-3 px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-brown-accent focus-visible:ring-inset sm:px-6"
                  aria-pressed={selectedItemId === item.id}
                >
                  <span
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-[#fff8eb] text-[0.67rem] font-semibold text-paper shadow-[0_4px_12px_rgb(73_48_30/18%)]"
                    style={{ backgroundColor: '#724a2d' }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <time className="text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-brown-accent">
                      {item.plannedTime}
                    </time>
                    <span className="mt-1 block font-editorial text-[1.05rem] font-medium leading-snug text-ink">
                      {item.place.name}
                    </span>
                    <span className="mt-1 block text-xs text-warm-muted">
                      {formatDuration(item.estimatedDurationMinutes)}
                    </span>
                  </span>
                  <PlaceThumbnail tripId={tripId} item={item} />
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function MapPlanner({ tripId }: { tripId: string }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [data, setData] = useState<ItineraryPageData | null>(null);
  const [selectedDay, setSelectedDay] = useState<MapDaySelection | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [routeStates, setRouteStates] = useState<Record<number, RouteState>>({});
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
        current === 'all' ||
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

  const days = useMemo(
    () => data?.itinerary?.days ?? [],
    [data?.itinerary?.days],
  );
  const isAllDays = selectedDay === 'all';
  const activeDay =
    (!isAllDays ? days.find((day) => day.day === selectedDay) : null) ??
    days[0] ??
    null;
  const planningLocked = Boolean(data?.trip.finalizedAt);
  const activeEndpoints = activeDay
    ? getDayEndpoints(data, activeDay.day)
    : { arrival: null, departure: null };
  const visibleItems = useMemo(
    () =>
      isAllDays
        ? days.flatMap((day) => day.items)
        : (activeDay?.items ?? []),
    [activeDay?.items, days, isAllDays],
  );
  const visibleArrivalPoint = isAllDays
    ? data?.trip.arrivalPoint ?? null
    : activeEndpoints.arrival;
  const visibleDeparturePoint = isAllDays
    ? data?.trip.departurePoint ?? null
    : activeEndpoints.departure;
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
  const routeKey = !isAllDays && activeDay
    ? getRouteCacheKey(
        tripId,
        activeDay.day,
        activeDay.items,
        activeEndpoints,
      )
    : null;

  const loadRoute = useCallback(
    async (day: { day: number; items: ItineraryItemView[] }) => {
      const endpoints = getDayEndpoints(data, day.day);
      const key = getRouteCacheKey(tripId, day.day, day.items, endpoints);

      const validPointCount =
        day.items.filter(hasValidCoordinates).length +
        (endpoints.arrival ? 1 : 0) +
        (endpoints.departure ? 1 : 0);
      if (validPointCount < 2) {
        const emptyRoute: TripRoute = {
          geometry: null,
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          segments: [],
        };
        routeCache.current.set(key, emptyRoute);
        setRouteStates((current) => ({
          ...current,
          [day.day]: { key, status: 'ready', route: emptyRoute },
        }));
        return;
      }

      const cached = routeCache.current.get(key);
      if (cached) {
        setRouteStates((current) => ({
          ...current,
          [day.day]: { key, status: 'ready', route: cached },
        }));
        return;
      }

      setRouteStates((current) => ({
        ...current,
        [day.day]: { key, status: 'loading', route: null },
      }));
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
        setRouteStates((current) =>
          current[day.day]?.key === key
            ? {
                ...current,
                [day.day]: { key, status: 'ready', route },
              }
            : current,
        );
      } catch {
        setRouteStates((current) =>
          current[day.day]?.key === key
            ? {
                ...current,
                [day.day]: { key, status: 'error', route: null },
              }
            : current,
        );
      } finally {
        routeRequests.current.delete(key);
      }
    },
    [data, tripId],
  );

  useEffect(() => {
    if (!activeDay || isSaving) return;
    const visibleDayNumbers = visibleRouteDayNumbers(
      days.map((day) => day.day),
      selectedDay ?? activeDay.day,
    );
    void Promise.resolve().then(() => {
      for (const day of days) {
        if (visibleDayNumbers.includes(day.day)) void loadRoute(day);
      }
    });
  }, [activeDay, days, isSaving, loadRoute, selectedDay]);

  useEffect(() => {
    let cancelled = false;
    if (!activeDay || isAllDays) return;
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
  }, [activeDay, isAllDays, tripId]);

  const activeRouteState = activeDay ? routeStates[activeDay.day] : undefined;
  const route =
    !isAllDays && activeRouteState?.key === routeKey
      ? activeRouteState.route
      : null;
  const visibleRoutes = days.flatMap((day) => {
    const endpoints = getDayEndpoints(data, day.day);
    const key = getRouteCacheKey(tripId, day.day, day.items, endpoints);
    const state = routeStates[day.day];
    if (
      (isAllDays || day.day === activeDay?.day) &&
      state?.key === key &&
      state.route
    ) {
      return [
        {
          day: day.day,
          route: state.route,
          color: routeColorForDay(day.day),
        },
      ];
    }
    return [];
  });
  const routeStatus: RouteStatus = isAllDays
    ? days.some((day) => routeStates[day.day]?.status === 'error')
      ? 'error'
      : visibleRoutes.length < days.length
        ? 'loading'
        : 'ready'
    : activeRouteState?.key === routeKey
      ? activeRouteState.status
      : 'idle';
  const routeTotals = visibleRoutes.reduce(
    (total, entry) => ({
      distance: total.distance + entry.route.totalDistanceMeters,
      duration: total.duration + entry.route.totalDurationSeconds,
    }),
    { distance: 0, duration: 0 },
  );
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
      const key = getRouteCacheKey(
        tripId,
        result.day,
        updatedDay.items,
        getDayEndpoints(result.data, result.day),
      );
      routeCache.current.set(key, result.route);
      setRouteStates((current) => ({
        ...current,
        [result.day]: { key, status: 'ready', route: result.route },
      }));
      setSelectedDay(result.day);
    }
    setData(result.data);
    setSelectedItemId(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (isSaving || planningLocked || !activeDay || !data) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const previousItems = activeDay.items;
    const fromIndex = previousItems.findIndex((item) => item.id === active.id);
    const toIndex = previousItems.findIndex((item) => item.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;

    const reorderedItems = arrayMove(previousItems, fromIndex, toIndex).map(
      (item, index) => ({ ...item, sortOrder: index }),
    );
    const oldRouteKey = getRouteCacheKey(
      tripId,
      activeDay.day,
      previousItems,
      activeEndpoints,
    );

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
    if (!activeDay || isSaving || planningLocked) return;
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
    if (isSaving || planningLocked) return;
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
    <main className="relative isolate min-h-[100dvh] overflow-hidden bg-parchment text-ink lg:h-[100dvh]">
      <header className="absolute inset-x-0 top-0 z-30 grid min-h-16 grid-cols-[1fr_auto_1fr] items-center rounded-b-[2rem] border-b border-white/55 bg-[#f8f4ed]/68 px-5 shadow-[0_10px_30px_rgb(62_50_38/8%)] backdrop-blur-[20px] sm:px-8">
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
          href={`/trip/${tripId}/itinerary?step=result`}
          className="inline-flex items-center gap-2 justify-self-end text-xs font-semibold text-ink underline-offset-4 transition-colors hover:text-brown-accent hover:underline"
        >
          Full itinerary
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </header>

      <div className="h-[100dvh]">
        <section
          aria-label={`${data.itinerary.destination} map`}
          className="absolute inset-0 z-0 min-h-[360px] overflow-hidden bg-warm-border"
        >
          <MapCanvas
            items={visibleItems}
            routes={visibleRoutes}
            arrivalPoint={visibleArrivalPoint}
            departurePoint={visibleDeparturePoint}
            selectedItemId={selectedItemId}
            onSelect={selectItem}
          />
        </section>

        <aside className="absolute inset-x-3 bottom-3 top-[4.75rem] z-20 flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-white/55 bg-[#f8f4ed]/78 shadow-[0_24px_70px_rgb(54_42_31/20%)] backdrop-blur-[24px] sm:inset-x-auto sm:right-4 sm:top-[5.25rem] sm:w-[min(500px,calc(100vw-2rem))] lg:bottom-5 lg:right-5 lg:top-[5.5rem] lg:w-[clamp(390px,32vw,500px)]">
          <div className="border-b border-warm-border/65 px-5 pb-4 pt-5 sm:px-6">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-brown-accent">
              Your itinerary
            </p>
            <div className="mt-2 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate font-editorial text-2xl font-medium tracking-[-0.035em] text-ink">
                  {data.itinerary.destination}
                </h1>
                <p className="mt-1 text-xs leading-5 text-warm-muted">
                  {isAllDays ? (
                    `${visibleItems.length} stops across the full trip`
                  ) : (
                    <>
                      Day {activeDay.day} ·{' '}
                      {activeDay.theme.replace(/^Day\s+\d+:\s*/i, '')}
                    </>
                  )}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-parchment px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-warm-muted">
                {days.length} {days.length === 1 ? 'day' : 'days'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 border-b border-warm-border/65 px-5 py-3 sm:px-6">
            <div
              className="flex min-w-0 flex-1 gap-2 overflow-x-auto"
              role="tablist"
              aria-label="Itinerary days"
            >
              <button
                type="button"
                role="tab"
                aria-selected={isAllDays}
                onClick={() => {
                  setSelectedDay('all');
                  setSelectedItemId(null);
                  setAiEditOpen(false);
                  setAddPlaceOpen(false);
                }}
                className={cn(
                  'h-8 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                  isAllDays
                    ? 'border-ink bg-ink text-paper'
                    : 'border-warm-border bg-parchment text-warm-muted hover:border-brown-accent/45 hover:text-ink',
                )}
              >
                All
              </button>
              {days.map((day) => {
              const active = !isAllDays && day.day === activeDay.day;
              return (
                <button
                  key={day.day}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSelectedDay(day.day);
                    setSelectedItemId(null);
                    setAiEditOpen(false);
                    setAddPlaceOpen(false);
                  }}
                  className={cn(
                    'h-8 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                    active
                      ? 'border-ink bg-ink text-paper'
                      : 'border-warm-border/80 bg-white/28 text-warm-muted hover:border-brown-accent/45 hover:text-ink',
                  )}
                >
                  <span
                    className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                    style={{ backgroundColor: routeColorForDay(day.day) }}
                    aria-hidden="true"
                  />
                  Day {day.day}
                </button>
              );
              })}
            </div>
            <button
              type="button"
              disabled={isSaving || isAllDays}
              onClick={() => {
                setAiEditOpen((open) => nextAiPanelState(open, selectedDay ?? 'all'));
                setAddPlaceOpen(false);
              }}
              aria-expanded={aiEditOpen}
              aria-label={isAllDays ? 'Choose a day before asking AI' : 'Ask AI to adjust this day'}
              title={isAllDays ? 'Choose a day to edit with AI' : 'Adjust this day with AI'}
              className={cn(
                'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brown-accent/40 disabled:cursor-not-allowed disabled:opacity-45',
                aiEditOpen
                  ? 'border-ink bg-ink text-paper'
                  : 'border-warm-border/80 bg-white/40 text-ink hover:bg-white/65',
              )}
            >
              <Bot className="size-3.5" aria-hidden="true" />
              Ask AI
            </button>
          </div>

          {aiEditOpen && !isAllDays && (
            <AiEditPanel
              tripId={tripId}
              day={activeDay.day}
              disabled={isSaving}
              onApplied={(result) => applyPlannerMutation(result)}
              onApplyStateChange={setIsSaving}
              onClose={() => setAiEditOpen(false)}
            />
          )}

          <div className="border-b border-warm-border/65 bg-white/22 px-5 py-3 sm:px-6">
            <div className="flex items-center gap-2 text-xs text-warm-muted">
              <Route
                className="size-3.5 shrink-0 text-brown-accent"
                aria-hidden="true"
              />
              <span>
                {visibleItems.length} stops
                {routeTotals.distance > 0 && (
                  <>
                    {' · '}
                    {formatRouteDistance(routeTotals.distance)} ·{' '}
                    {formatRouteDuration(routeTotals.duration)} travel
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
                  onClick={() => {
                    if (isAllDays) {
                      for (const day of days) void loadRoute(day);
                    } else {
                      void loadRoute(activeDay);
                    }
                  }}
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
            {planningLocked && (
              <p className="mt-2 text-[0.68rem] leading-5 text-warm-muted">
                This trip is finalized. Use Ask AI or Live Trip for future changes.
              </p>
            )}
            {isAllDays && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Day route colors">
                {days.map((day) => (
                  <span key={day.day} className="inline-flex items-center gap-1.5 text-[0.68rem] text-warm-muted">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: routeColorForDay(day.day) }}
                      aria-hidden="true"
                    />
                    Day {day.day}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {isAllDays ? (
              <AllDaysItinerary
                tripId={tripId}
                days={days}
                selectedItemId={selectedItemId}
                onSelect={selectItem}
                cardRefs={cardRefs}
              />
            ) : (
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
                  {(activeEndpoints.arrival ||
                    (activeDay.day === days[0]?.day &&
                      data.trip.arrivalTime)) && (
                    <div className="border-b border-warm-border/65 bg-white/20 px-5 py-4 sm:px-6">
                      <div className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brown-accent text-paper">
                          <PlaneLanding className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-brown-accent">
                            Arrive{data.trip.arrivalTime ? ` · ${data.trip.arrivalTime}` : ''}
                          </p>
                          {activeEndpoints.arrival && (
                            <p className="mt-1 font-editorial text-base font-medium text-ink">
                              {activeEndpoints.arrival.name}
                            </p>
                          )}
                        </div>
                      </div>
                      <TravelSegment
                        segment={
                          activeDay.items[0]
                            ? (routeSegments.get(
                                `${ARRIVAL_ENDPOINT_ID}:${activeDay.items[0].id}`,
                              ) ?? null)
                            : null
                        }
                      />
                    </div>
                  )}
                  {activeDay.items.map((item, index) => {
                    const nextItem = activeDay.items[index + 1];
                    const segment = nextItem
                      ? (routeSegments.get(`${item.id}:${nextItem.id}`) ?? null)
                      : null;
                    return (
                      <SortableItineraryCard
                        key={item.id}
                        tripId={tripId}
                        item={item}
                        index={index}
                        selected={item.id === selectedItemId}
                        onSelect={() => selectItem(item.id)}
                        cardRef={(element) => {
                          if (element) cardRefs.current.set(item.id, element);
                          else cardRefs.current.delete(item.id);
                        }}
                        segment={segment}
                        disabled={isSaving || planningLocked}
                        editable={!planningLocked}
                        onRemove={() => void handleRemovePlace(item)}
                        weather={weatherByItemId.get(item.id) ?? null}
                      />
                    );
                  })}
                  {(activeEndpoints.departure ||
                    (activeDay.day === days.at(-1)?.day &&
                      data.trip.departureTime)) && (
                    <div className="bg-white/20">
                      <TravelSegment
                        segment={
                          activeDay.items.at(-1)
                            ? (routeSegments.get(
                                `${activeDay.items.at(-1)!.id}:${DEPARTURE_ENDPOINT_ID}`,
                              ) ?? null)
                            : null
                        }
                      />
                      <div className="flex items-start gap-3 px-5 py-4 sm:px-6">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
                          <PlaneTakeoff className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          {activeEndpoints.departure && (
                            <p className="font-editorial text-base font-medium text-ink">
                              {activeEndpoints.departure.name}
                            </p>
                          )}
                          <p className="mt-1 text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-brown-accent">
                            Depart{data.trip.departureTime ? ` · ${data.trip.departureTime}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </SortableContext>
              </DndContext>
            </div>
            )}

            {!planningLocked && !isAllDays && (
              <div className="border-b border-warm-border/65 bg-white/20 p-4 sm:px-5">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    setAddPlaceOpen((open) => !open);
                    setAiEditOpen(false);
                  }}
                  aria-expanded={addPlaceOpen}
                  className={cn(
                    'inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brown-accent/40 disabled:opacity-45',
                    addPlaceOpen
                      ? 'border-ink bg-ink text-paper'
                      : 'border-warm-border/80 bg-white/40 text-warm-muted hover:bg-white/65 hover:text-ink',
                  )}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add place
                </button>
              </div>
            )}

            {addPlaceOpen && (
              <AddPlacePanel
                tripId={tripId}
                day={activeDay.day}
                disabled={isSaving}
                onAdd={handleAddPlace}
                onClose={() => setAddPlaceOpen(false)}
              />
            )}
          </div>

          <div className="border-t border-warm-border/65 bg-[#f8f4ed]/72 p-4 backdrop-blur-xl sm:px-5">
            <Link
              href={`/trip/${tripId}/live`}
              className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#28231d] px-5 font-editorial text-base font-semibold text-paper shadow-[0_9px_24px_rgb(38_30_23/22%)] transition-colors hover:bg-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8f4ed]"
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
