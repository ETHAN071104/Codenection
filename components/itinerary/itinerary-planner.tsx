'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  Plane,
  Sparkles,
  Star,
  UsersRound,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SystemLoading,
  SystemNotice,
  SystemState,
} from '@/components/ui/system-state';
import { AtlasShell } from '@/components/travel-dna/atlas-shell';
import { formatTripDuration } from '@/lib/trips/duration';
import { phase2Fetch } from '@/lib/phase2/client';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { hasConfirmedScope } from '@/lib/trips/setup-core';
import { TravelBoundariesStep } from './travel-boundaries-step';
import type {
  DestinationSuggestion,
  ExplorationPreference,
  ItineraryPageData,
  ItineraryItemView,
  ItineraryView,
} from '@/lib/phase2/types';
import {
  DestinationGlobe,
  type DestinationGlobeHandle,
} from './destination-globe';

type Screen = 'loading' | 'ready' | 'error';
export type PlanningStep =
  | 'destination'
  | 'timing'
  | 'scope'
  | 'mode'
  | 'result';
type PendingAction =
  | 'resolve'
  | 'suggest'
  | 'accept'
  | 'scope'
  | 'mode'
  | 'finalize'
  | null;

function formatRatingCount(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(value);
}

const EXPLORATION_OPTIONS: {
  value: ExplorationPreference;
  label: string;
  description: string;
}[] = [
  {
    value: 'stay_local',
    label: 'Stay local',
    description: 'Keep every day close to the base destination.',
  },
  {
    value: 'nearby_day_trips',
    label: 'Nearby day trips',
    description: 'Mix the base with practical nearby excursions.',
  },
  {
    value: 'explore_freely',
    label: 'Explore freely',
    description: 'Cover a wider practical area from one base.',
  },
];

function explorationLabel(value: ExplorationPreference) {
  return EXPLORATION_OPTIONS.find((option) => option.value === value)?.label;
}

function HostSetupWaiting({
  tripId,
  data,
}: {
  tripId: string;
  data: ItineraryPageData;
}) {
  const { trip } = data;
  const organiser = trip.hostDisplayName || 'Your trip organiser';
  const scopeReady = hasConfirmedScope(trip.setupStage);
  const collaborativeReady = trip.setupStage === 'collaborative_ready';
  const aiReady = trip.setupStage === 'ai_ready' && Boolean(data.itinerary);
  const preparing = trip.setupStage === 'preparing';

  return (
    <AtlasShell tripId={tripId} sectionLabel="TRIP SETUP">
      <section className="mx-auto w-full max-w-3xl rounded-2xl border border-warm-border bg-paper p-6 shadow-[var(--journey-shadow)] sm:p-10">
        <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
          SHARED TRIP SETUP
        </p>
        <h1 className="mt-4 font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
          {trip.isHost
            ? 'Your shared setup is in progress'
            : `${organiser} is setting up the trip`}
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-warm-muted">
          {trip.isHost
            ? 'Keep this page open while the shared plan is being prepared.'
            : 'The trip host is making the shared choices. This page updates automatically.'}
        </p>

        <dl className="mt-8 divide-y divide-warm-border rounded-xl border border-warm-border bg-parchment px-5">
          <div className="flex items-center justify-between gap-4 py-4">
            <dt className="text-sm font-semibold text-warm-muted">
              Destination
            </dt>
            <dd className="inline-flex items-center gap-2 text-right font-semibold text-ink">
              {trip.destination || 'Waiting…'}
              {trip.destination && (
                <Check
                  className="size-4 text-brown-accent"
                  aria-hidden="true"
                />
              )}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-4">
            <dt className="text-sm font-semibold text-warm-muted">Arrival</dt>
            <dd className="text-right font-semibold text-ink">
              {trip.arrivalTime ? `Arrive · ${trip.arrivalTime}` : 'Not set'}
              {trip.arrivalPoint && (
                <span className="mt-1 block text-xs font-normal text-warm-muted">
                  {trip.arrivalPoint.name}
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-4">
            <dt className="text-sm font-semibold text-warm-muted">Departure</dt>
            <dd className="text-right font-semibold text-ink">
              {trip.departureTime
                ? `Depart · ${trip.departureTime}`
                : 'Not set'}
              {trip.departurePoint && (
                <span className="mt-1 block text-xs font-normal text-warm-muted">
                  {trip.departurePoint.name}
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-4">
            <dt className="text-sm font-semibold text-warm-muted">
              Travel range
            </dt>
            <dd className="inline-flex items-center gap-2 text-right font-semibold text-ink">
              {scopeReady
                ? explorationLabel(trip.explorationPreference)
                : 'Waiting…'}
              {scopeReady && (
                <Check
                  className="size-4 text-brown-accent"
                  aria-hidden="true"
                />
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-4">
            <dt className="text-sm font-semibold text-warm-muted">
              Place selection
            </dt>
            <dd className="inline-flex items-center gap-2 text-right font-semibold text-ink">
              {collaborativeReady
                ? 'Matched places ready'
                : trip.planningMode === 'collaborative'
                  ? 'Preparing matched places'
                  : trip.planningMode === 'ai'
                    ? 'Arranging matched places'
                    : 'Waiting…'}
              {trip.planningMode && (
                <Check
                  className="size-4 text-brown-accent"
                  aria-hidden="true"
                />
              )}
            </dd>
          </div>
        </dl>

        {preparing && (
          <SystemNotice
            className="mt-6"
            title={
              trip.planningMode === 'collaborative'
                ? `Preparing places${trip.destination ? ` for ${trip.destination}` : ''}…`
                : 'Preparing the shared itinerary…'
            }
            description="Your saved trip details are safe. This status will update when the next step is ready."
          />
        )}

        {collaborativeReady && (
          <SystemNotice
            className="mt-6"
            title="Matched places are ready"
            description="Waiting for the trip organiser to start place selection for everyone."
          />
        )}

        {aiReady && (
          <Link
            href={`/trip/${tripId}/itinerary?step=result`}
            className={buttonVariants({
              className:
                'mt-7 h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90',
            })}
          >
            View generated plan
            <ArrowRight aria-hidden="true" />
          </Link>
        )}
      </section>
    </AtlasShell>
  );
}

function ItineraryPlacePhoto({
  tripId,
  item,
  priority = false,
}: {
  tripId: string;
  item: ItineraryItemView;
  priority?: boolean;
}) {
  const photoName = item.place.photo?.name ?? null;
  const photoUrl = photoName
    ? `/api/trips/${tripId}/place-photo?name=${encodeURIComponent(photoName)}`
    : item.place.externalPlaceId
      ? `/api/trips/${tripId}/place-photo?placeId=${encodeURIComponent(item.place.externalPlaceId)}`
      : null;
  const [failed, setFailed] = useState(!photoUrl);
  const attribution = item.place.photo?.attributions[0] ?? null;

  return (
    <div className="relative min-h-44 overflow-hidden rounded-[1rem] border border-white/70 bg-[#e5e0d7] md:min-h-full">
      {photoUrl && !failed ? (
        <Image
          src={photoUrl}
          alt={item.place.name}
          fill
          sizes="(min-width: 1024px) 360px, (min-width: 768px) 32vw, 100vw"
          unoptimized
          priority={priority}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex size-full min-h-44 items-center justify-center text-[#777066]">
          <div className="text-center">
            <MapPin className="mx-auto size-6" aria-hidden="true" />
            <p className="mt-2 text-xs font-medium">Place photo unavailable</p>
          </div>
        </div>
      )}
      {!failed && attribution && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-7 text-right text-[0.62rem] text-white/85">
          {attribution.uri ? (
            <a
              href={attribution.uri}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:underline"
            >
              Photo by {attribution.displayName}
            </a>
          ) : (
            <span>Photo by {attribution.displayName}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ItineraryResult({
  tripId,
  itinerary,
}: {
  tripId: string;
  itinerary: ItineraryView;
}) {
  const placeCount = itinerary.days.reduce(
    (total, day) => total + day.items.length,
    0,
  );

  return (
    <section className="mx-auto w-full max-w-5xl">
      <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
        TRIP ITINERARY
      </p>
      <div className="mt-4 flex flex-col gap-4 border-b border-warm-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
            {itinerary.destination}
          </h1>
          <p className="mt-4 text-warm-muted">
            {formatTripDuration(itinerary.durationDays)} with {placeCount} real
            places from Google Places.
          </p>
        </div>
        <span className="text-sm text-warm-muted">Times are approximate.</span>
      </div>

      <div className="mt-10 space-y-12">
        {itinerary.days.map((day) => (
          <article key={day.day}>
            <div className="grid gap-2 sm:grid-cols-[90px_1fr] sm:items-baseline">
              <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
                DAY {day.day}
              </p>
              <h2 className="font-editorial text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                {day.theme}
              </h2>
              {day.area && (
                <p className="text-sm text-warm-muted">
                  {day.mode === 'day_trip' ? 'Day trip area' : 'Base area'}:{' '}
                  {day.area}
                </p>
              )}
            </div>

            <ol className="mt-6 space-y-3">
              {day.items.map((item, itemIndex) => (
                <li
                  key={item.id}
                  className="grid gap-5 overflow-hidden rounded-[1.4rem] border border-warm-border/85 bg-paper/95 p-4 shadow-[0_16px_40px_rgb(67_53_38/7%)] sm:p-5 md:grid-cols-[72px_minmax(0,1fr)_minmax(260px,36%)] md:gap-6"
                >
                  <time className="font-editorial text-lg font-semibold text-ink">
                    {item.plannedTime}
                  </time>
                  <div className="min-w-0 py-0.5">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <h3 className="font-editorial text-xl font-semibold tracking-[-0.03em]">
                        {item.place.name}
                      </h3>
                      {item.place.rating !== null && (
                        <p className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-ink">
                          <Star
                            className="size-4 fill-current"
                            aria-hidden="true"
                          />
                          {item.place.rating.toFixed(1)} Google rating
                          {item.place.ratingCount !== null &&
                            ` (${formatRatingCount(item.place.ratingCount)})`}
                        </p>
                      )}
                    </div>
                    <p className="mt-4 text-[0.95rem] leading-7 text-ink/78">
                      {item.reason}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-warm-muted">
                      <span className="inline-flex items-center gap-2">
                        <Clock3 className="size-4" aria-hidden="true" />
                        {item.estimatedDurationMinutes} min estimated
                      </span>
                      {item.estimatedCost !== null && (
                        <span>
                          Estimated cost RM {item.estimatedCost.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ItineraryPlacePhoto
                    tripId={tripId}
                    item={item}
                    priority={day.day === 1 && itemIndex === 0}
                  />
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ItineraryPlanner({
  tripId,
  initialStep,
}: {
  tripId: string;
  initialStep: PlanningStep | null;
}) {
  const router = useRouter();
  const initialStepRef = useRef(initialStep);
  const globeRef = useRef<DestinationGlobeHandle>(null);
  const [screen, setScreen] = useState<Screen>('loading');
  const [data, setData] = useState<ItineraryPageData | null>(null);
  const [suggestion, setSuggestion] = useState<DestinationSuggestion | null>(
    null,
  );
  const [destinationInput, setDestinationInput] = useState('');
  const [suggestionScope, setSuggestionScope] = useState<string | null>(null);
  const [suggestionHistory, setSuggestionHistory] = useState<string[]>([]);
  const [explorationPreference, setExplorationPreference] =
    useState<ExplorationPreference>('nearby_day_trips');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [planningStep, setPlanningStep] = useState<PlanningStep>(
    initialStep ?? 'destination',
  );
  const [editingDestination, setEditingDestination] = useState(false);
  const [matchedPlaceCount, setMatchedPlaceCount] = useState<number | null>(
    null,
  );
  const [syncedTravellerCount, setSyncedTravellerCount] = useState<
    number | null
  >(null);
  const matchedPreparationRef = useRef(false);

  function goToStep(step: PlanningStep, replace = false) {
    setError(null);
    setPlanningStep(step);
    const href = `/trip/${tripId}/itinerary?step=${step}`;
    if (replace) router.replace(href);
    else router.push(href);
  }

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setScreen('loading');
      setError(null);
      try {
        const payload = await phase2Fetch<ItineraryPageData>(
          `/api/trips/${tripId}/itinerary`,
        );
        setData(payload);
        setDestinationInput(payload.trip.destinationInput ?? '');
        setExplorationPreference(payload.trip.explorationPreference);
        const requestedStep = initialStepRef.current;
        if (!payload.trip.finalizedAt && payload.trip.setupStage === 'places') {
          router.replace(`/trip/${tripId}/places`);
          setScreen('ready');
          return;
        }
        if (payload.trip.finalizedAt) {
          if (requestedStep === 'result') {
            setPlanningStep('result');
          } else {
            router.replace(`/trip/${tripId}/plan`);
          }
          setScreen('ready');
          return;
        }
        if (
          (requestedStep === 'timing' ||
            requestedStep === 'scope' ||
            requestedStep === 'mode') &&
          !payload.trip.destination
        ) {
          setPlanningStep('destination');
        } else if (requestedStep === 'result' && !payload.itinerary) {
          setPlanningStep('destination');
        } else if (!requestedStep && payload.itinerary) {
          setPlanningStep('result');
        }
        setScreen('ready');
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'We could not load this itinerary.',
        );
        if (showLoading) setScreen('error');
      }
    },
    [router, tripId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(true));
  }, [load]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void ensureAnonymousUser().then(() => {
      if (disposed) return;
      channel = supabase
        .channel(`trip-setup:${tripId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'trips',
            filter: `id=eq.${tripId}`,
          },
          () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => void load(false), 120);
          },
        )
        .subscribe();
    });

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load, tripId]);

  useEffect(() => {
    const stage = data?.trip.setupStage;
    if (
      screen !== 'ready' ||
      planningStep !== 'mode' ||
      !data?.trip.isHost ||
      (stage !== 'mode' &&
        stage !== 'preparing' &&
        stage !== 'collaborative_ready') ||
      matchedPreparationRef.current
    ) {
      return;
    }
    matchedPreparationRef.current = true;
    void startCollaborativePlanning();
  }, [data?.trip.isHost, data?.trip.setupStage, planningStep, screen]);

  async function saveDestination(destination: string, input: string | null) {
    if (!data) return;
    const payload = await phase2Fetch<{
      destination: string;
      destinationInput: string | null;
    }>(`/api/trips/${tripId}/destination`, {
      method: 'PUT',
      body: JSON.stringify({ destination, destinationInput: input }),
    });
    setData({
      ...data,
      trip: {
        ...data.trip,
        destination: payload.destination,
        destinationInput: payload.destinationInput,
        arrivalTime: null,
        departureTime: null,
        arrivalPoint: null,
        departurePoint: null,
        planningMode: null,
        setupStage: 'timing',
      },
    });
    setSuggestion(null);
    setEditingDestination(false);
  }

  async function suggestDestination(
    geographicScope: string | null,
    acceptSpecificInput = false,
  ) {
    setPendingAction(acceptSpecificInput ? 'resolve' : 'suggest');
    setError(null);
    try {
      const payload = await phase2Fetch<{
        suggestion: DestinationSuggestion;
      }>(`/api/trips/${tripId}/destination-suggestion`, {
        method: 'POST',
        body: JSON.stringify({
          destinationInput: geographicScope,
          previousSuggestions: suggestionHistory,
          replaceExisting: editingDestination,
        }),
      });
      await globeRef.current?.flyTo(payload.suggestion.destination);
      if (
        acceptSpecificInput &&
        geographicScope &&
        payload.suggestion.inputWasSpecific
      ) {
        await saveDestination(payload.suggestion.destination, geographicScope);
        goToStep('timing');
      } else {
        setSuggestion(payload.suggestion);
        setSuggestionScope(geographicScope);
        setSuggestionHistory((current) => [
          ...current,
          payload.suggestion.destination,
        ]);
      }
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'We could not suggest a destination.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function acceptDestination() {
    if (!suggestion || !data) return;
    setPendingAction('accept');
    setError(null);
    try {
      await saveDestination(suggestion.destination, suggestionScope);
      goToStep('timing');
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'We could not save this destination.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function saveScope() {
    if (!data?.trip.destination) {
      goToStep('destination');
      return;
    }
    setPendingAction('scope');
    setError(null);
    try {
      const payload = await phase2Fetch<{
        explorationPreference: ExplorationPreference;
      }>(`/api/trips/${tripId}/itinerary`, {
        method: 'PATCH',
        body: JSON.stringify({ explorationPreference }),
      });
      setData({
        ...data,
        trip: {
          ...data.trip,
          explorationPreference: payload.explorationPreference,
          geographicScope: null,
          planningMode: null,
          setupStage: 'mode',
        },
      });
      goToStep('mode');
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'We could not save this geographic scope.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  function saveTravelBoundaries(value: {
    startDate: string | null;
    endDate: string | null;
    arrivalTime: string | null;
    departureTime: string | null;
    arrivalPoint: ItineraryPageData['trip']['arrivalPoint'];
    departurePoint: ItineraryPageData['trip']['departurePoint'];
  }) {
    if (!data) return;
    setData({
      ...data,
      trip: {
        ...data.trip,
        ...value,
        planningMode: null,
        setupStage: 'scope',
      },
    });
    goToStep('scope');
  }

  async function startCollaborativePlanning() {
    if (!data) return;
    setPendingAction('mode');
    setError(null);
    try {
      if (data.trip.setupStage === 'mode') {
        await phase2Fetch(`/api/trips/${tripId}/setup`, {
          method: 'PATCH',
          body: JSON.stringify({ planningMode: 'collaborative' }),
        });
        setData((current) =>
          current
            ? {
                ...current,
                trip: {
                  ...current.trip,
                  planningMode: 'collaborative',
                  setupStage: 'preparing',
                },
              }
            : current,
        );
      }

      const ready = await phase2Fetch<{
        supported: boolean;
        availability?: string;
        candidates: unknown[];
        selectionMembers: unknown[];
      }>(`/api/trips/${tripId}/candidate-places`);
      if (!ready.supported) {
        throw new Error(
          ready.availability === 'insufficient_candidates'
            ? 'We could not prepare enough matched places for this trip.'
            : 'Matched places are still being prepared.',
        );
      }
      setMatchedPlaceCount(ready.candidates.length);
      setSyncedTravellerCount(ready.selectionMembers.length);
      setData((current) =>
        current
          ? {
              ...current,
              trip: {
                ...current.trip,
                planningMode: 'collaborative',
                setupStage: 'collaborative_ready',
              },
            }
          : current,
      );
      goToStep('mode', true);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'We could not start collaborative planning.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function openPlaceSelection() {
    setPendingAction('mode');
    setError(null);
    try {
      await phase2Fetch(`/api/trips/${tripId}/setup`, { method: 'PUT' });
      router.push(`/trip/${tripId}/places`);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'We could not open place selection.',
      );
      setPendingAction(null);
    }
  }

  async function finalizeTrip() {
    if (pendingAction || !data?.itinerary) return;
    setPendingAction('finalize');
    setError(null);
    try {
      await phase2Fetch(`/api/trips/${tripId}/finalize`, { method: 'POST' });
      router.push(`/trip/${tripId}/plan`);
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error
          ? finalizeError.message
          : 'We could not finalize this trip.',
      );
      setPendingAction(null);
    }
  }

  if (screen === 'loading') {
    return (
      <AtlasShell tripId={tripId} sectionLabel="TRIP ITINERARY">
        <SystemLoading
          title="Preparing your trip"
          description="We’re loading the saved destination, planning choices, and itinerary."
        />
      </AtlasShell>
    );
  }

  if (screen === 'error' || !data) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="TRIP ITINERARY">
        <SystemState
          role="alert"
          eyebrow="Trip itinerary"
          title="We could not load this itinerary."
          description={
            <>
              <p>{error}</p>
              <p className="mt-2">No saved trip details were changed.</p>
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

  if (
    !data.trip.finalizedAt &&
    (data.trip.setupStage === 'preparing' ||
      (!data.trip.isHost && data.trip.setupStage !== 'ai_ready'))
  ) {
    return <HostSetupWaiting tripId={tripId} data={data} />;
  }

  if (planningStep === 'result' && data.itinerary) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="TRIP ITINERARY">
        <div className="w-full py-2">
          <ItineraryResult tripId={tripId} itinerary={data.itinerary} />
          {error && (
            <SystemNotice
              role="alert"
              className="mx-auto mt-6 w-full max-w-5xl"
              title="We couldn’t finalize this trip."
              description="The itinerary is still saved. Try again when you are ready to open the final map."
            />
          )}
          <div className="mx-auto mt-10 flex w-full max-w-5xl flex-wrap gap-3 border-t border-warm-border pt-7">
            {data.trip.finalizedAt ? (
              <Link
                href={`/trip/${tripId}/plan`}
                className={buttonVariants({
                  className:
                    'h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90',
                })}
              >
                Open finalized map
                <MapPin aria-hidden="true" />
              </Link>
            ) : (
              <Button
                type="button"
                onClick={() => void finalizeTrip()}
                disabled={pendingAction !== null}
                className="h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90"
              >
                {pendingAction === 'finalize' ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <MapPin aria-hidden="true" />
                )}
                {pendingAction === 'finalize'
                  ? 'Finalizing trip…'
                  : 'Finalize and open map'}
              </Button>
            )}
            <Link
              href={`/trip/${tripId}`}
              className={buttonVariants({
                className:
                  'h-11 rounded-xl border-warm-border bg-paper px-5 text-ink hover:bg-parchment',
              })}
            >
              Return to trip room
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link
              href={`/trip/${tripId}/summary`}
              className={buttonVariants({
                variant: 'outline',
                className:
                  'h-11 rounded-xl border-warm-border bg-transparent px-5 text-ink hover:bg-paper',
              })}
            >
              View group summary
            </Link>
          </div>
        </div>
      </AtlasShell>
    );
  }

  const destinationEditing = !data.trip.destination || editingDestination;

  if (planningStep === 'destination') {
    const normalizedDestination = destinationInput.trim().replace(/\s+/g, ' ');
    const isBusy = pendingAction !== null;

    return (
      <main className="relative isolate min-h-[100dvh] overflow-x-hidden bg-[#071019] text-white lg:h-[100dvh] lg:overflow-hidden">
        <DestinationGlobe
          ref={globeRef}
          tripId={tripId}
          idleEnabled={
            destinationEditing &&
            !suggestion &&
            !destinationInput.trim() &&
            pendingAction === null
          }
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,13,0.86)_0%,rgba(2,8,13,0.52)_32%,rgba(2,8,13,0.08)_62%,rgba(2,8,13,0.36)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,7,11,0.66)_0%,transparent_25%,transparent_70%,rgba(2,7,11,0.72)_100%)]" />

        <div className="pointer-events-none relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1500px] flex-col px-5 sm:px-8 lg:px-12">
          <header className="pointer-events-auto grid min-h-20 grid-cols-[1fr_auto_1fr] items-center border-b border-white/18 text-sm sm:min-h-24">
            <Link
              href={`/trip/${tripId}`}
              className="inline-flex w-fit items-center gap-2 rounded-full py-2 pr-3 font-medium text-white/80 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Trip room
            </Link>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-white/78 sm:text-xs">
              TRIP PLANNING
            </p>
            <p className="justify-self-end text-xs font-medium text-white/55 sm:text-sm">
              {formatTripDuration(data.trip.durationDays)} trip
            </p>
          </header>

          <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(0,34rem)_1fr] lg:py-12">
            <section className="pointer-events-auto self-center">
              <p className="text-xs font-semibold tracking-[0.2em] text-[#dfb483]">
                DESTINATION
              </p>
              <h1 className="mt-4 max-w-xl font-editorial text-[clamp(3.1rem,6vw,6.6rem)] font-semibold leading-[0.88] tracking-[-0.065em] text-white text-shadow-[0_2px_22px_rgba(0,0,0,0.38)]">
                Where do you want to go?
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-white/70 sm:text-lg">
                Enter a place, or let your group&apos;s Travel DNA choose a
                destination for this{' '}
                {formatTripDuration(data.trip.durationDays)} trip.
              </p>

              {data.trip.destination && !editingDestination ? (
                <div className="mt-8 max-w-lg rounded-2xl border border-white/20 bg-black/35 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-[#dfb483]">
                    CURRENT DESTINATION
                  </p>
                  <h2 className="mt-3 font-editorial text-3xl font-semibold tracking-[-0.035em]">
                    {data.trip.destination}
                  </h2>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      type="button"
                      className="h-12 rounded-full bg-white px-6 text-[#0a1117] hover:bg-white/90"
                      onClick={() => goToStep('timing')}
                    >
                      Continue
                      <ArrowRight aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 rounded-full border-white/25 bg-white/10 px-6 text-white backdrop-blur-md hover:bg-white/18 hover:text-white"
                      onClick={() => {
                        setDestinationInput(
                          data.trip.destinationInput ??
                            data.trip.destination ??
                            '',
                        );
                        setSuggestion(null);
                        setEditingDestination(true);
                        void globeRef.current?.returnToGlobe(false);
                      }}
                    >
                      Choose another
                    </Button>
                  </div>
                </div>
              ) : !suggestion ? (
                <form
                  className="mt-8 max-w-lg rounded-2xl border border-white/20 bg-black/35 p-4 shadow-2xl backdrop-blur-xl sm:p-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (normalizedDestination.length >= 3) {
                      globeRef.current?.pauseIdle();
                      void suggestDestination(normalizedDestination, true);
                    }
                  }}
                >
                  <label
                    htmlFor="destination-input"
                    className="text-xs font-semibold tracking-[0.08em] text-white/75"
                  >
                    CITY, STATE, REGION, OR COUNTRY
                  </label>
                  <Input
                    id="destination-input"
                    value={destinationInput}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDestinationInput(value);
                      if (value.trim()) globeRef.current?.pauseIdle();
                      else globeRef.current?.resumeIdle();
                    }}
                    onFocus={() => globeRef.current?.pauseIdle()}
                    placeholder="Johor Bahru, Kedah, or Japan"
                    autoComplete="off"
                    maxLength={120}
                    className="mt-3 h-14 rounded-xl border-white/20 bg-white/12 px-4 text-base text-white placeholder:text-white/42 focus-visible:border-white/55 focus-visible:ring-white/15"
                  />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Button
                      type="submit"
                      className="h-12 rounded-full bg-white px-5 text-[#0a1117] hover:bg-white/90"
                      disabled={isBusy || normalizedDestination.length < 3}
                    >
                      {pendingAction === 'resolve' ? (
                        <LoaderCircle
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <MapPin aria-hidden="true" />
                      )}
                      Use this destination
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 rounded-full border-white/25 bg-white/10 px-5 text-white backdrop-blur-md hover:bg-white/18 hover:text-white"
                      onClick={() => {
                        globeRef.current?.pauseIdle();
                        void suggestDestination(normalizedDestination || null);
                      }}
                      disabled={isBusy}
                    >
                      {pendingAction === 'suggest' ? (
                        <LoaderCircle
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Sparkles aria-hidden="true" />
                      )}
                      Suggest for us
                    </Button>
                  </div>
                </form>
              ) : null}

              {error && (
                <p
                  role="alert"
                  className="mt-4 max-w-lg rounded-xl border border-red-200/25 bg-red-950/55 px-4 py-3 text-sm leading-6 text-red-50 backdrop-blur-lg"
                >
                  {error}
                </p>
              )}

              <Link
                href={`/trip/${tripId}/summary`}
                className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/65 underline-offset-4 transition hover:text-white hover:underline"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back to group summary
              </Link>
            </section>

            {suggestion && destinationEditing && (
              <aside className="pointer-events-auto w-full max-w-md self-end justify-self-end rounded-2xl border border-white/20 bg-black/42 p-5 shadow-2xl backdrop-blur-xl sm:p-6 lg:mb-10">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[#dfb483]">
                  PROPOSED DESTINATION
                </p>
                <h2 className="mt-3 font-editorial text-4xl font-semibold tracking-[-0.045em]">
                  {suggestion.destination}
                </h2>
                <p className="mt-3 leading-7 text-white/72">
                  {suggestion.reason}
                </p>
                {suggestionScope && (
                  <p className="mt-4 text-sm text-white/55">
                    Your chosen area: {suggestionScope}
                  </p>
                )}
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    className="h-12 rounded-full bg-white px-5 text-[#0a1117] hover:bg-white/90"
                    onClick={() => void acceptDestination()}
                    disabled={isBusy}
                  >
                    {pendingAction === 'accept' ? (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <MapPin aria-hidden="true" />
                    )}
                    Use destination
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-full border-white/25 bg-white/10 px-5 text-white backdrop-blur-md hover:bg-white/18 hover:text-white"
                    onClick={() => {
                      globeRef.current?.pauseIdle();
                      void suggestDestination(suggestionScope);
                    }}
                    disabled={isBusy}
                  >
                    {pendingAction === 'suggest' ? (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Sparkles aria-hidden="true" />
                    )}
                    Suggest another
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-full border-white/20 bg-black/15 px-5 text-white/80 hover:bg-white/12 hover:text-white sm:col-span-2"
                    onClick={() => {
                      setSuggestion(null);
                      setError(null);
                      void globeRef.current?.returnToGlobe(
                        destinationInput.trim().length === 0,
                      );
                    }}
                    disabled={isBusy}
                  >
                    Choose manually
                  </Button>
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (planningStep === 'timing' && data.trip.destination) {
    return (
      <main className="relative isolate min-h-[100dvh] overflow-x-hidden bg-[#bba993] text-ink">
        <Image
          src="/images/flight-page.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(35,24,17,0.13),rgba(255,244,224,0.04)_45%,rgba(50,40,33,0.10))]"
        />

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1280px] flex-col px-4 sm:px-6 lg:px-8">
          <header className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center rounded-b-[1.75rem] border border-t-0 border-white/55 bg-[#faf7f1]/90 px-5 text-sm shadow-[0_14px_40px_rgb(55_43_32/12%)] backdrop-blur-xl sm:px-7">
            <Link
              href={`/trip/${tripId}`}
              className="inline-flex w-fit items-center gap-2 font-semibold text-ink transition-opacity hover:opacity-65"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Trip room
            </Link>
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-ink sm:text-xs">
              <Plane className="size-4 text-brown-accent" aria-hidden="true" />
              TRIP PLANNING
            </p>
            <div className="flex items-center justify-self-end gap-4 text-xs text-warm-muted sm:text-sm">
              <span className="hidden sm:inline">Step 2 of 4</span>
              <span className="flex gap-1.5" aria-label="Step 2 of 4">
                {[1, 2, 3, 4].map((step) => (
                  <span
                    key={step}
                    className={`h-1.5 rounded-full ${
                      step <= 2 ? 'w-8 bg-brown-accent' : 'w-5 bg-ink/10'
                    }`}
                  />
                ))}
              </span>
            </div>
          </header>

          <div className="flex flex-1 items-center py-5 sm:py-7">
            <TravelBoundariesStep
              tripId={tripId}
              destination={data.trip.destination}
              startDate={data.trip.startDate}
              endDate={data.trip.endDate}
              initialArrivalTime={data.trip.arrivalTime}
              initialDepartureTime={data.trip.departureTime}
              initialArrivalPoint={data.trip.arrivalPoint}
              initialDeparturePoint={data.trip.departurePoint}
              onSaved={saveTravelBoundaries}
              onBack={() => goToStep('destination')}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <AtlasShell tripId={tripId} sectionLabel="TRIP PLANNING">
      <section className="mx-auto w-full max-w-3xl rounded-2xl border border-warm-border bg-paper p-6 shadow-[var(--journey-shadow)] sm:p-10">
        <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
          {planningStep === 'timing'
            ? 'TRAVEL TIMES'
            : planningStep === 'scope'
              ? 'GEOGRAPHIC SCOPE'
              : 'MATCHED PLACES'}
        </p>

        {planningStep === 'scope' && data.trip.destination && (
          <>
            <h1 className="mt-4 font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              How far should this trip reach?
            </h1>
            <p className="mt-5 max-w-2xl leading-7 text-warm-muted">
              {data.trip.destination} remains the base. This choice is saved
              before you choose how the trip will be planned.
            </p>
            <fieldset className="mt-8 border-y border-warm-border py-6">
              <legend className="text-sm font-semibold text-ink">
                Geographic scope
              </legend>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {EXPLORATION_OPTIONS.map((option) => {
                  const selected = explorationPreference === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setExplorationPreference(option.value)}
                      disabled={pendingAction !== null}
                      aria-pressed={selected}
                      className={`min-h-28 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/30 ${
                        selected
                          ? 'border-ink bg-ink text-paper'
                          : 'border-warm-border bg-paper text-ink hover:bg-parchment'
                      }`}
                    >
                      <span className="block font-semibold">
                        {option.label}
                      </span>
                      <span
                        className={`mt-1 block text-sm leading-5 ${
                          selected ? 'text-paper/80' : 'text-warm-muted'
                        }`}
                      >
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                type="button"
                className="h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90"
                onClick={() => void saveScope()}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'scope' && (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                )}
                Continue to planning mode
                <ArrowRight aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-warm-border bg-paper px-5 text-ink hover:bg-parchment"
                onClick={() => goToStep('timing')}
                disabled={pendingAction !== null}
              >
                Back to travel times
              </Button>
            </div>
          </>
        )}

        {planningStep === 'mode' && data.trip.destination && (
          <>
            {data.trip.setupStage === 'collaborative_ready' &&
            matchedPlaceCount !== null &&
            syncedTravellerCount !== null ? (
              <div className="py-3 text-center sm:py-6">
                <p className="text-xs font-semibold tracking-[0.19em] text-brown-accent">
                  MATCHED PLACES READY
                </p>
                <h1 className="mx-auto mt-5 max-w-2xl text-balance font-editorial text-4xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-6xl">
                  We found places your group can choose from.
                </h1>
                <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-warm-muted sm:text-lg">
                  Next, everyone moves to the place selection screen together.
                </p>

                <dl className="mt-9 grid rounded-2xl border border-warm-border bg-parchment/70 text-left sm:grid-cols-3">
                  <div className="flex items-center gap-4 px-5 py-5 sm:border-r sm:border-warm-border">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-brown-accent">
                      <MapPin className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <dd className="font-editorial text-2xl font-semibold">
                        {matchedPlaceCount}
                      </dd>
                      <dt className="text-sm text-warm-muted">matched places</dt>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 border-t border-warm-border px-5 py-5 sm:border-r sm:border-t-0">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-brown-accent">
                      <UsersRound className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <dd className="font-editorial text-2xl font-semibold">
                        {syncedTravellerCount}
                      </dd>
                      <dt className="text-sm text-warm-muted">travellers synced</dt>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 border-t border-warm-border px-5 py-5 sm:border-t-0">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-brown-accent">
                      <Check className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <dd className="font-semibold">Ready to start</dd>
                      <dt className="mt-1 text-sm text-warm-muted">choosing</dt>
                    </div>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => void openPlaceSelection()}
                  disabled={pendingAction !== null}
                  className="group mt-6 inline-flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-ink px-6 text-base font-semibold text-paper transition-colors hover:bg-ink/90 disabled:cursor-wait disabled:opacity-60"
                >
                  {pendingAction === 'mode' ? (
                    <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                  ) : null}
                  {pendingAction === 'mode' ? 'Opening places' : 'Next: choose places'}
                  {pendingAction !== 'mode' && (
                    <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  )}
                </button>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-6 h-11 rounded-xl border-warm-border bg-transparent px-5 text-ink hover:bg-parchment"
                  onClick={() => goToStep('scope')}
                  disabled={pendingAction !== null}
                >
                  Back to scope
                </Button>
              </div>
            ) : (
              <div className="py-10 text-center">
                <LoaderCircle className="mx-auto size-7 animate-spin text-brown-accent" aria-hidden="true" />
                <h1 className="mt-5 font-editorial text-4xl font-semibold tracking-[-0.045em]">
                  Preparing matched places
                </h1>
                <p className="mt-3 text-warm-muted">
                  We are getting the shared choices ready.
                </p>
              </div>
            )}
          </>
        )}

        {error && planningStep === 'mode' && (
          <SystemNotice
            role="alert"
            className="mt-6 border-brown-accent/30"
            title="We couldn’t finish this itinerary."
            description={
              <>
                <p>{error}</p>
                <p className="mt-1">
                  Your destination and trip details are still saved.
                </p>
              </>
            }
            actions={
              <>
                <button
                  type="button"
                  onClick={() => {
                    matchedPreparationRef.current = true;
                    void startCollaborativePlanning();
                  }}
                  disabled={pendingAction !== null}
                  className="font-semibold text-brown-accent underline-offset-4 hover:underline disabled:opacity-50"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => goToStep('destination')}
                  disabled={pendingAction !== null}
                  className="font-semibold text-warm-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
                >
                  Change destination
                </button>
              </>
            }
          />
        )}

        {error && planningStep !== 'mode' && (
          <SystemNotice
            role="alert"
            className="mt-6 border-brown-accent/30"
            title="We couldn’t save that change."
            description={
              <>
                <p>{error}</p>
                <p className="mt-1">
                  Your previously saved trip details are unchanged. Use the form
                  above to try again.
                </p>
              </>
            }
          />
        )}
      </section>
    </AtlasShell>
  );
}
