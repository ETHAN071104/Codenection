'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CalendarDays,
  Check,
  Clock3,
  Heart,
  Landmark,
  Leaf,
  LoaderCircle,
  Route,
  RotateCcw,
  Sparkles,
  Star,
  Utensils,
  X,
} from 'lucide-react';
import { JourneyShell } from '@/components/travel-dna/journey-shell';
import {
  SystemLoading,
  SystemNotice,
  SystemState,
} from '@/components/ui/system-state';
import { buttonVariants } from '@/components/ui/button';
import type { GeographicDayClustering } from '@/lib/malaysia-places/day-clustering-core';
import type { DeterministicDraftSchedule } from '@/lib/malaysia-places/deterministic-scheduling-core';
import type { RankedCandidate } from '@/lib/malaysia-places/group-ranking';
import { consensusTiers } from '@/lib/malaysia-places/consensus-core';
import type { StayAreaRecommendation } from '@/lib/malaysia-places/stay-area-core';
import { hasUsablePlacePhoto } from '@/lib/malaysia-places/photo-core';
import { phase2Fetch, TripApiError } from '@/lib/phase2/client';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type CandidateResponse = {
  supported: boolean;
  isHost: boolean;
  availability?:
    | 'destination_required'
    | 'insufficient_candidates'
    | 'setup_preparing';
  destination: string;
  durationDays: number | null;
  candidates: RankedCandidate[];
  selected: RankedCandidate[];
  stayArea: StayAreaRecommendation;
  dayGroups: GeographicDayClustering;
  draftSchedule: DeterministicDraftSchedule;
  scheduleFingerprint?: string;
  hasPersistedItinerary?: boolean;
  scheduleMatchesPersistedItinerary?: boolean;
  confirmationIssue?: string | null;
  selectionMembers: {
    userId: string;
    displayName: string;
    completed: boolean;
  }[];
  currentUserSelectionComplete: boolean;
  allSelectionComplete: boolean;
};

type MapPlanConfirmation = {
  ok: true;
  outcome: 'created' | 'replaced' | 'unchanged';
  savedItems: number;
};

class MapPlanConfirmationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'MapPlanConfirmationError';
    this.status = status;
    this.code = code;
  }
}

async function confirmMapPlanRequest(
  tripId: string,
  expectedFingerprint: string,
  replaceExisting: boolean,
) {
  await ensureAnonymousUser();
  const supabase = getSupabaseBrowserClient();
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token) {
    throw new MapPlanConfirmationError(
      'Please reconnect and retry.',
      401,
      'AUTH_REQUIRED',
    );
  }

  const response = await fetch(`/api/trips/${tripId}/candidate-places`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expectedFingerprint, replaceExisting }),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as
    | MapPlanConfirmation
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const error = payload && 'error' in payload ? payload.error : null;
    throw new MapPlanConfirmationError(
      error?.message ?? 'The map plan could not be saved.',
      response.status,
      error?.code ?? 'MAP_PLAN_SAVE_FAILED',
    );
  }
  return payload as MapPlanConfirmation;
}

type CandidateView = 'choose' | 'review' | 'stay' | 'schedule';

const REASON_LABELS: Record<string, string> = {
  'Strong food match': "A strong match for your group's food interests",
  'Strong culture match': "Matches your group's interest in culture",
  'Strong nature match': "Matches your group's interest in nature",
  'Strong photography match': "A strong fit for your group's photo interests",
  'Strong visitor rating': 'Highly rated by Google visitors',
  'Fits group budget': "Fits your group's shared budget",
  'Curated Kuala Lumpur candidate': 'A curated Kuala Lumpur highlight',
  'Highly rated with strong visitor feedback.':
    'Highly rated with strong visitor feedback.',
  'Good fit for a lower-cost trip.': 'Good fit for a lower-cost trip.',
};

function label(value: string | null) {
  return value
    ? value
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;
}

function humanReason(reason: string) {
  return REASON_LABELS[reason] ?? reason;
}

export function CandidatePlaces({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [data, setData] = useState<CandidateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'load' | 'mutation'>('load');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(new Set<string>());
  const [candidateOrder, setCandidateOrder] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [view, setView] = useState<CandidateView>('choose');
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING');
  const [mapPlanSaving, setMapPlanSaving] = useState(false);
  const [mapPlanError, setMapPlanError] = useState<string | null>(null);
  const [replacementWarning, setReplacementWarning] = useState(false);
  const [completionSaving, setCompletionSaving] = useState(false);
  const [planningWithAi, setPlanningWithAi] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const response = await phase2Fetch<CandidateResponse>(
          `/api/trips/${tripId}/candidate-places`,
        );
        setData(response);
        setCandidateOrder((current) => {
          const incomingIds = response.candidates.map((place) => place.id);
          if (!current.length) return incomingIds;
          const incoming = new Set(incomingIds);
          const retained = current.filter((id) => incoming.has(id));
          const retainedSet = new Set(retained);
          return [
            ...retained,
            ...incomingIds.filter((id) => !retainedSet.has(id)),
          ];
        });
        setError(null);
      } catch (loadError) {
        if (
          loadError instanceof TripApiError &&
          loadError.code === 'TRIP_FINALIZED'
        ) {
          router.replace(`/trip/${tripId}/plan`);
          return;
        }
        setErrorKind('load');
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Candidate places are unavailable.',
        );
      } finally {
        setLoading(false);
      }
    },
    [router, tripId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(true));
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => window.scrollTo({ top: 0 }), 60);
    return () => window.clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void ensureAnonymousUser()
      .then(() => {
        if (disposed) return;
        channel = supabase
          .channel(`trip-place-votes:${tripId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'trip_place_votes',
              filter: `trip_id=eq.${tripId}`,
            },
            (payload) => {
              const next = payload.new as {
                finalized_at?: string | null;
                planning_mode?: string | null;
                setup_stage?: string;
              };
              if (next.finalized_at) {
                router.replace(`/trip/${tripId}/plan`);
                return;
              }
              if (
                next.planning_mode === 'ai' &&
                next.setup_stage === 'ai_ready'
              ) {
                router.replace(`/trip/${tripId}/itinerary?step=result`);
                return;
              }
              if (refreshTimer.current) clearTimeout(refreshTimer.current);
              refreshTimer.current = setTimeout(() => void load(false), 120);
            },
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'trips',
              filter: `id=eq.${tripId}`,
            },
            () => {
              if (refreshTimer.current) clearTimeout(refreshTimer.current);
              refreshTimer.current = setTimeout(() => void load(false), 120);
            },
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'trip_place_selection_members',
              filter: `trip_id=eq.${tripId}`,
            },
            () => {
              if (refreshTimer.current) clearTimeout(refreshTimer.current);
              refreshTimer.current = setTimeout(() => void load(false), 120);
            },
          )
          .subscribe((status) => {
            if (!disposed) setRealtimeStatus(status);
          });
      })
      .catch(() => {
        if (!disposed) {
          setRealtimeStatus('CHANNEL_ERROR');
        }
      });

    return () => {
      disposed = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load, tripId]);

  async function toggle(place: RankedCandidate) {
    if (pending.has(place.id)) return false;

    await ensureAnonymousUser();
    setPending((current) => new Set(current).add(place.id));
    const selected = !place.currentUserSelected;
    setData((current) =>
      current
        ? {
            ...current,
            candidates: current.candidates.map((item) =>
              item.id === place.id
                ? {
                    ...item,
                    currentUserSelected: selected,
                    voteCount: Math.max(
                      0,
                      item.voteCount + (selected ? 1 : -1),
                    ),
                  }
                : item,
            ),
          }
        : current,
    );

    try {
      await phase2Fetch(`/api/trips/${tripId}/candidate-places`, {
        method: 'POST',
        body: JSON.stringify({ placeId: place.id, selected }),
      });
      await load(false);
      return true;
    } catch (toggleError) {
      const message =
        toggleError instanceof Error
          ? toggleError.message
          : 'Could not save your selection.';
      await load(false);
      setErrorKind('mutation');
      setError(message);
      return false;
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(place.id);
        return next;
      });
    }
  }

  async function setSelectionComplete(completed: boolean) {
    if (completionSaving) return;
    setCompletionSaving(true);
    setError(null);
    try {
      await phase2Fetch(`/api/trips/${tripId}/candidate-places`, {
        method: 'PATCH',
        body: JSON.stringify({ completed }),
      });
      await load(false);
      if (!completed) setView('review');
    } catch (completionError) {
      setErrorKind('mutation');
      setError(
        completionError instanceof Error
          ? completionError.message
          : 'Could not update your selection status.',
      );
    } finally {
      setCompletionSaving(false);
    }
  }

  async function planAllWithAi() {
    if (!data?.isHost || planningWithAi) return;
    setPlanningWithAi(true);
    setError(null);
    try {
      await phase2Fetch(`/api/trips/${tripId}/setup`, {
        method: 'PATCH',
        body: JSON.stringify({ planningMode: 'ai' }),
      });
      await phase2Fetch(`/api/trips/${tripId}/itinerary`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await phase2Fetch(`/api/trips/${tripId}/finalize`, { method: 'POST' });
      router.push(`/trip/${tripId}/plan`);
    } catch (planningError) {
      setErrorKind('mutation');
      setError(
        planningError instanceof Error
          ? planningError.message
          : 'We could not arrange the matched places.',
      );
      setPlanningWithAi(false);
    }
  }

  function advance() {
    if (currentIndex >= candidateOrder.length - 1) {
      setView('review');
      return;
    }
    setCurrentIndex((index) => index + 1);
  }

  async function confirmCurrentSchedule(replaceExisting: boolean) {
    if (!data?.scheduleFingerprint || mapPlanSaving) return;
    setMapPlanSaving(true);
    setMapPlanError(null);
    try {
      await confirmMapPlanRequest(
        tripId,
        data.scheduleFingerprint,
        replaceExisting,
      );
      await phase2Fetch(`/api/trips/${tripId}/finalize`, { method: 'POST' });
      router.push(`/trip/${tripId}/plan`);
    } catch (confirmationError) {
      if (
        confirmationError instanceof MapPlanConfirmationError &&
        confirmationError.code === 'SCHEDULE_CHANGED'
      ) {
        setReplacementWarning(false);
        await load(false);
        setMapPlanError(
          "Your group's choices changed while you were reviewing. We've refreshed the schedule. Please check it and open the map again.",
        );
      } else if (
        confirmationError instanceof MapPlanConfirmationError &&
        confirmationError.code === 'EXISTING_PLAN_REPLACEMENT_REQUIRED'
      ) {
        setReplacementWarning(true);
      } else {
        setMapPlanError(
          confirmationError instanceof Error
            ? confirmationError.message
            : 'The map plan could not be saved.',
        );
      }
    } finally {
      setMapPlanSaving(false);
    }
  }

  function requestMapPlan() {
    if (!data?.scheduleFingerprint) {
      setMapPlanError(
        data?.confirmationIssue ??
          'Refresh this schedule before opening the map plan.',
      );
      return;
    }
    if (data.confirmationIssue) {
      setMapPlanError(data.confirmationIssue);
      return;
    }
    setMapPlanError(null);
    if (data.hasPersistedItinerary && !data.scheduleMatchesPersistedItinerary) {
      setReplacementWarning(true);
      return;
    }
    void confirmCurrentSchedule(false);
  }

  if (loading) {
    return (
      <JourneyShell tripId={tripId} currentStep="Places">
        <SystemLoading
          title="Gathering places for your group"
          description="We’re loading real places for this destination and the group’s saved choices."
        />
      </JourneyShell>
    );
  }

  if (error && !data) {
    return (
      <JourneyShell tripId={tripId} currentStep="Places">
        <SystemState
          role="alert"
          eyebrow="Suggested places"
          title="We could not load your place suggestions."
          description={
            <>
              <p>{error}</p>
              <p className="mt-2">
                Your group’s existing choices have not been changed.
              </p>
            </>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => void load(true)}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40"
              >
                Try again
              </button>
              <Link
                href={`/trip/${tripId}/itinerary?step=destination`}
                className={buttonVariants({
                  variant: 'outline',
                  className:
                    'h-11 rounded-xl border-warm-border bg-paper px-5 text-ink hover:bg-parchment',
                })}
              >
                Change destination
              </Link>
              <Link
                href={`/trip/${tripId}/itinerary?step=mode`}
                className={buttonVariants({
                  variant: 'ghost',
                  className:
                    'h-11 rounded-xl px-5 text-warm-muted hover:bg-parchment hover:text-ink',
                })}
              >
                Back to trip setup
              </Link>
            </>
          }
        />
      </JourneyShell>
    );
  }

  if (!data?.supported) {
    if (data?.availability === 'setup_preparing') {
      return (
        <JourneyShell tripId={tripId} currentStep="Places">
          <SystemLoading
            title={`Preparing places${data.destination ? ` for ${data.destination}` : ''}`}
            description="The trip host is gathering the shared place choices. This page will update automatically."
          />
        </JourneyShell>
      );
    }
    const destinationRequired = data?.availability === 'destination_required';
    return (
      <JourneyShell tripId={tripId} currentStep="Places">
        <SystemState
          eyebrow="Suggested places"
          title={
            destinationRequired
              ? 'Choose a destination first.'
              : `We couldn’t prepare enough places for ${data?.destination || 'this destination'}.`
          }
          description={
            destinationRequired
              ? 'Your trip and Travel DNA are safe. Choose a destination before reviewing places together.'
              : 'Your destination and group choices are still saved. Try the place search again, change destination, or use the existing AI planner.'
          }
          actions={
            <>
              {!destinationRequired && (
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-ink px-6 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40"
                >
                  Try again
                </button>
              )}
              <Link
                href={`/trip/${tripId}/itinerary?step=destination`}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-warm-border bg-paper px-6 text-sm font-semibold text-ink hover:bg-parchment"
              >
                {destinationRequired
                  ? 'Choose destination'
                  : 'Change destination'}
              </Link>
              {!destinationRequired && (
                <Link
                  href={`/trip/${tripId}/itinerary?step=mode`}
                  className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-sm font-semibold text-warm-muted hover:bg-parchment hover:text-ink"
                >
                  Back to trip setup
                </Link>
              )}
            </>
          }
        />
      </JourneyShell>
    );
  }

  const orderedCandidates = candidateOrder
    .map((id) => data.candidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is RankedCandidate => Boolean(candidate));
  const activePlace = orderedCandidates[currentIndex] ?? orderedCandidates[0];
  const selectedByCurrentUser = data.candidates.filter(
    (place) => place.currentUserSelected,
  ).length;

  if (
    data.currentUserSelectionComplete &&
    !data.allSelectionComplete &&
    (view === 'choose' || view === 'review')
  ) {
    return (
      <JourneyShell tripId={tripId} currentStep="Places">
        <SelectionWaiting
          members={data.selectionMembers}
          saving={completionSaving}
          onEdit={() => void setSelectionComplete(false)}
        />
      </JourneyShell>
    );
  }

  if (data.allSelectionComplete && (view === 'choose' || view === 'review')) {
    return (
      <JourneyShell tripId={tripId} currentStep="Places">
        <ConsensusResult data={data} onOrganise={() => setView('stay')} />
      </JourneyShell>
    );
  }

  if (view === 'stay') {
    return (
      <JourneyShell tripId={tripId} currentStep="Plan" contentAlign="start">
        <StayAreaPresentation
          recommendation={data.stayArea}
          selectedPlaceCount={data.selected.length}
          onBack={() => setView('review')}
          onContinue={() => setView('schedule')}
        />
      </JourneyShell>
    );
  }

  if (view === 'schedule') {
    return (
      <JourneyShell tripId={tripId} currentStep="Plan" contentAlign="start">
        <SchedulePresentation
          destination={data.destination}
          durationDays={data.durationDays}
          grouping={data.dayGroups}
          recommendation={data.stayArea}
          schedule={data.draftSchedule}
          onBack={() => setView('stay')}
          hasPersistedItinerary={Boolean(data.hasPersistedItinerary)}
          scheduleMatchesPersistedItinerary={Boolean(
            data.scheduleMatchesPersistedItinerary,
          )}
          saving={mapPlanSaving}
          error={mapPlanError}
          replacementWarning={replacementWarning}
          isHost={data.isHost}
          onOpenMap={requestMapPlan}
          onCancelReplacement={() => setReplacementWarning(false)}
          onConfirmReplacement={() => {
            setReplacementWarning(false);
            void confirmCurrentSchedule(true);
          }}
        />
      </JourneyShell>
    );
  }

  if (view === 'review') {
    return (
      <JourneyShell tripId={tripId} currentStep="Places">
        <SelectedPlacesReview
          data={data}
          pending={pending}
          onBack={() => {
            setCurrentIndex((index) =>
              Math.min(index, Math.max(orderedCandidates.length - 1, 0)),
            );
            setView('choose');
          }}
          onComplete={() => void setSelectionComplete(true)}
          onToggle={toggle}
          completionSaving={completionSaving}
          error={errorKind === 'mutation' ? error : null}
        />
      </JourneyShell>
    );
  }

  if (!activePlace) {
    return (
      <JourneyShell tripId={tripId} currentStep="Places">
        <SystemState
          eyebrow="Suggested places"
          title={
            orderedCandidates.length > 0
              ? 'You have reviewed every place.'
              : 'No place suggestions are available yet.'
          }
          description={
            orderedCandidates.length > 0
              ? 'Your saved choices are ready to review.'
              : 'We could not find curated places for this trip. Your trip room and Travel DNA are still available.'
          }
          actions={
            orderedCandidates.length > 0 ? (
              <button
                type="button"
                onClick={() => setView('review')}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper"
              >
                Review kept places
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void load(true)}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper"
              >
                Try again
              </button>
            )
          }
        />
      </JourneyShell>
    );
  }

  return (
    <PlaceEditorialScreen
      key={activePlace.id}
      tripId={tripId}
      place={activePlace}
      currentIndex={currentIndex}
      totalCount={orderedCandidates.length}
      selectedCount={selectedByCurrentUser}
      realtimeStatus={realtimeStatus}
      error={error}
      errorKind={errorKind}
      pending={pending.has(activePlace.id)}
      onRefresh={() => void load(false)}
      onDone={() => setView('review')}
      onSkip={advance}
      onKeep={async () => {
        if (await toggle(activePlace)) advance();
      }}
      onPlanWithAi={() => void planAllWithAi()}
      planningWithAi={planningWithAi}
      canPlanWithAi={data.isHost}
    />
  );
}

const JOURNEY_STEPS = ['Preferences', 'Places', 'Plan', 'Ready'] as const;

function reasonTitle(reason: string) {
  const normalized = reason.toLowerCase();
  if (normalized.includes('food')) return 'Food';
  if (normalized.includes('photo')) return 'Photography';
  if (normalized.includes('culture') || normalized.includes('heritage'))
    return 'Culture & heritage';
  if (normalized.includes('nature')) return 'Nature';
  if (normalized.includes('budget') || normalized.includes('cost'))
    return 'Value';
  if (normalized.includes('rating') || normalized.includes('visitor'))
    return 'Visitor favourite';
  return 'Group fit';
}

function ReasonIcon({ reason }: { reason: string }) {
  const normalized = reason.toLowerCase();
  const className = 'mt-0.5 size-4 shrink-0 text-white/70';
  if (normalized.includes('food'))
    return <Utensils className={className} aria-hidden="true" />;
  if (normalized.includes('photo'))
    return <Camera className={className} aria-hidden="true" />;
  if (normalized.includes('culture') || normalized.includes('heritage'))
    return <Landmark className={className} aria-hidden="true" />;
  if (normalized.includes('nature'))
    return <Leaf className={className} aria-hidden="true" />;
  return <Star className={className} aria-hidden="true" />;
}

function placeDescription(place: RankedCandidate) {
  const placeType = label(place.category)?.toLowerCase();
  const location = place.area ?? place.city ?? place.country;
  const rating = place.googleRating
    ? ` Rated ${place.googleRating.toFixed(1)} by Google visitors.`
    : '';
  return `${placeType ? `A ${placeType}` : 'A group-matched place'} in ${location}, selected for how well it fits your group.${rating}`;
}

function googleMapsUrl(place: RankedCandidate) {
  const query = encodeURIComponent(
    [place.name, place.city, place.country].filter(Boolean).join(', '),
  );
  const placeId = place.googlePlaceId
    ? `&query_place_id=${encodeURIComponent(place.googlePlaceId)}`
    : '';
  return `https://www.google.com/maps/search/?api=1&query=${query}${placeId}`;
}

function PlaceEditorialScreen({
  tripId,
  place,
  currentIndex,
  totalCount,
  selectedCount,
  realtimeStatus,
  error,
  errorKind,
  pending,
  onRefresh,
  onDone,
  onSkip,
  onKeep,
  onPlanWithAi,
  planningWithAi,
  canPlanWithAi,
}: {
  tripId: string;
  place: RankedCandidate;
  currentIndex: number;
  totalCount: number;
  selectedCount: number;
  realtimeStatus: string;
  error: string | null;
  errorKind: 'load' | 'mutation';
  pending: boolean;
  onRefresh: () => void;
  onDone: () => void;
  onSkip: () => void;
  onKeep: () => void;
  onPlanWithAi: () => void;
  planningWithAi: boolean;
  canPlanWithAi: boolean;
}) {
  const photoName = place.photoName;
  const hasPhoto = hasUsablePlacePhoto({ photoName });
  const [photoState, setPhotoState] = useState<'loading' | 'ready' | 'failed'>(
    hasPhoto ? 'loading' : 'failed',
  );
  const photoVisible = hasPhoto && photoState !== 'failed';
  const photoUrl = photoName
    ? `/api/trips/${tripId}/place-photo?name=${encodeURIComponent(photoName)}`
    : null;

  const attribution = place.photoAttributions[0] ?? null;
  const selectionPaused = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(
    realtimeStatus,
  );

  return (
    <main
      data-testid="choose-places"
      data-realtime-status={realtimeStatus}
      className={cn(
        'relative isolate min-h-[100dvh] overflow-x-hidden bg-[#151714] text-white',
        !photoVisible && 'bg-[#232722]',
      )}
    >
      {photoVisible && photoUrl && (
        <>
          {photoState === 'loading' && (
            <div
              aria-hidden="true"
              className="absolute inset-0 animate-pulse bg-[#30352f]"
            />
          )}
          <Image
            src={photoUrl}
            alt=""
            fill
            sizes="100vw"
            unoptimized
            loading="eager"
            fetchPriority="high"
            onLoad={() => setPhotoState('ready')}
            onError={() => setPhotoState('failed')}
            className={cn(
              'object-cover object-center transition-opacity duration-500 motion-reduce:transition-none',
              photoState === 'ready' ? 'opacity-100' : 'opacity-0',
            )}
          />
        </>
      )}
      <div aria-hidden="true" className="absolute inset-0 bg-black/20" />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,9,12,.64)_0%,rgba(5,9,12,.08)_25%,rgba(5,9,12,.12)_47%,rgba(5,8,10,.84)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,8,9,.48)_0%,transparent_52%,rgba(4,8,9,.58)_100%)]"
      />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1760px] flex-col px-5 sm:px-8 lg:px-12 xl:px-16">
        <header className="grid min-h-20 items-center gap-4 border-b border-white/20 py-4 md:grid-cols-[1fr_auto_1fr]">
          <Link
            href={`/trip/${tripId}`}
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Trip room
          </Link>
          <nav
            aria-label="Trip planning progress"
            className="order-3 md:order-none"
          >
            <ol className="grid grid-cols-4 gap-3 sm:gap-5">
              {JOURNEY_STEPS.map((step) => {
                const active = step === 'Places';
                return (
                  <li
                    key={step}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'min-w-16 border-b pb-2 text-center text-[0.64rem] font-medium uppercase tracking-[0.15em] sm:min-w-24 sm:text-xs',
                      active
                        ? 'border-white text-white'
                        : 'border-white/20 text-white/45',
                    )}
                  >
                    {step}
                  </li>
                );
              })}
            </ol>
          </nav>
          <button
            type="button"
            onClick={onDone}
            className="inline-flex justify-self-end text-sm font-medium text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Done ({selectedCount})
          </button>
        </header>

        {(error || selectionPaused) && (
          <div
            role={error ? 'alert' : 'status'}
            className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-white/25 bg-black/25 px-4 py-3 text-sm text-white/85"
          >
            <span>
              {error
                ? errorKind === 'mutation'
                  ? 'That choice did not update. Your previous selection is safe.'
                  : 'We could not refresh the latest choices.'
                : 'Live updates are paused. Your saved choices are safe.'}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              className="font-semibold underline underline-offset-4 hover:text-white"
            >
              Refresh
            </button>
          </div>
        )}

        <section className="grid flex-1 gap-10 pb-4 pt-10 md:grid-cols-[minmax(0,1fr)_17rem] md:items-end md:gap-12 md:pb-28 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-20 xl:gap-28">
          <div className="max-w-[52rem] md:self-end">
            <p className="font-editorial text-2xl tracking-[-0.025em] text-white sm:text-3xl">
              Suggested for your group
            </p>
            <div className="mt-3 h-px w-full max-w-[32rem] bg-white/70" />
            <h1 className="mt-5 text-balance font-editorial text-[clamp(3.6rem,7vw,7.8rem)] font-medium leading-[0.82] tracking-[-0.065em] text-white [text-shadow:0_2px_24px_rgba(0,0,0,.35)]">
              {place.name}
            </h1>
            {(place.city || place.area) && (
              <p className="mt-4 text-lg font-medium uppercase tracking-[0.16em] text-white/90 sm:text-2xl">
                {[place.area, place.city]
                  .filter((value, index, values) =>
                    value
                      ? values.findIndex(
                          (candidate) =>
                            candidate?.toLowerCase() === value.toLowerCase(),
                        ) === index &&
                        !place.name.toLowerCase().includes(value.toLowerCase())
                      : false,
                  )
                  .slice(0, 1)
                  .map((value) => `of ${value}`)}
              </p>
            )}
            <p className="mt-5 max-w-[42rem] text-base leading-7 text-white/82 sm:text-lg sm:leading-8">
              {placeDescription(place)}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/60 sm:text-sm">
              <span aria-live="polite">
                {currentIndex + 1} of {totalCount} · {selectedCount} kept by you
              </span>
              {photoState === 'ready' && attribution && (
                <span>
                  Photo by{' '}
                  {attribution.uri ? (
                    <a
                      href={attribution.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-white"
                    >
                      {attribution.displayName}
                    </a>
                  ) : (
                    attribution.displayName
                  )}
                </span>
              )}
            </div>
          </div>

          <aside className="space-y-10 text-sm text-white/78 md:self-start md:pt-10 lg:text-base">
            <section>
              <div className="h-px w-full bg-white/75" />
              <h2 className="mt-4 text-sm font-semibold uppercase tracking-[0.05em] text-white lg:text-base">
                Location &amp; details
              </h2>
              <dl className="mt-3 space-y-1.5 leading-6">
                {place.area && (
                  <div>
                    <dt className="sr-only">Area</dt>
                    <dd>{place.area}</dd>
                  </div>
                )}
                {place.city && (
                  <div className="grid grid-cols-[auto_1fr] gap-1.5">
                    <dt>City:</dt>
                    <dd>{place.city}</dd>
                  </div>
                )}
                <div className="grid grid-cols-[auto_1fr] gap-1.5">
                  <dt>Country:</dt>
                  <dd>{place.country}</dd>
                </div>
                {place.category && (
                  <div className="grid grid-cols-[auto_1fr] gap-1.5">
                    <dt>Type:</dt>
                    <dd>{label(place.category)}</dd>
                  </div>
                )}
                {place.googleRating !== null && (
                  <div className="grid grid-cols-[auto_1fr] gap-1.5">
                    <dt>Rating:</dt>
                    <dd>
                      {place.googleRating.toFixed(1)}
                      {place.googleRatingCount
                        ? ` (${place.googleRatingCount.toLocaleString()} reviews)`
                        : ''}
                    </dd>
                  </div>
                )}
              </dl>
              <a
                href={googleMapsUrl(place)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 font-medium text-white underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white"
              >
                View on Google Maps
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </a>
            </section>

            <section>
              <div className="h-px w-full bg-white/75" />
              <h2 className="mt-4 text-sm font-semibold uppercase tracking-[0.05em] text-white lg:text-base">
                Group match details
              </h2>
              <ul className="mt-4 space-y-4">
                {place.reasons.slice(0, 3).map((reason) => (
                  <li key={reason} className="flex gap-3">
                    <ReasonIcon reason={reason} />
                    <div>
                      <h3 className="font-semibold text-white">
                        {reasonTitle(reason)}
                      </h3>
                      <p className="mt-0.5 leading-5 text-white/72">
                        {humanReason(reason).replace(/[.!?]+$/, '')}.
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </section>

        <footer className="sticky bottom-0 z-20 -mx-5 mt-6 grid grid-cols-2 gap-2 border-t border-white/15 bg-black/45 p-3 backdrop-blur-md sm:-mx-8 sm:px-8 md:absolute md:bottom-6 md:left-1/2 md:mx-0 md:mt-0 md:w-[min(54rem,62vw)] md:-translate-x-1/2 md:grid-cols-3 md:rounded-[1.6rem] md:border md:border-white/30 md:bg-white/30 md:p-2 md:shadow-2xl">
          <button
            type="button"
            onClick={onSkip}
            disabled={planningWithAi}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[1.1rem] bg-white/78 px-5 text-sm font-medium text-[#242424] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
          >
            <X className="size-4" aria-hidden="true" />
            Skip
          </button>
          <button
            type="button"
            aria-pressed={place.currentUserSelected}
            disabled={pending || planningWithAi}
            onClick={onKeep}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[1.1rem] bg-white px-5 text-sm font-semibold text-[#20211f] transition-colors hover:bg-[#f4f1ea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-65"
          >
            {pending ? (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            ) : place.currentUserSelected ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Heart className="size-4" aria-hidden="true" />
            )}
            {place.currentUserSelected ? 'Kept' : 'Keep'}
          </button>
          <button
            type="button"
            onClick={onPlanWithAi}
            disabled={!canPlanWithAi || planningWithAi || pending}
            title={canPlanWithAi ? undefined : 'The trip host can start AI planning'}
            className="col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-[1.1rem] bg-[#24201c] px-5 text-sm font-semibold text-[#fffdf9] transition-colors hover:bg-[#332d27] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-55 md:col-span-1"
          >
            {planningWithAi ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            {planningWithAi ? 'Arranging places' : 'Plan with AI'}
          </button>
        </footer>
      </div>
    </main>
  );
}

function SelectionWaiting({
  members,
  saving,
  onEdit,
}: {
  members: CandidateResponse['selectionMembers'];
  saving: boolean;
  onEdit: () => void;
}) {
  return (
    <section className="mx-auto w-full max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brown-accent">
        Place selection
      </p>
      <h1 className="mt-4 font-editorial text-5xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl">
        You’re done choosing.
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-8 text-warm-muted">
        Your votes are saved. Waiting for the rest of your group…
      </p>

      <ul className="mt-8 divide-y divide-warm-border rounded-2xl border border-warm-border bg-paper px-5 shadow-editorial">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex min-h-16 items-center justify-between gap-4 py-4"
          >
            <span className="font-semibold text-ink">{member.displayName}</span>
            <span
              className={`inline-flex items-center gap-2 text-sm font-semibold ${
                member.completed ? 'text-brown-accent' : 'text-warm-muted'
              }`}
            >
              {member.completed ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Clock3 className="size-4" aria-hidden="true" />
              )}
              {member.completed ? 'Ready' : 'Choosing places…'}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={saving}
        onClick={onEdit}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-warm-border bg-paper px-5 text-sm font-semibold text-ink hover:bg-parchment disabled:cursor-wait disabled:opacity-60"
      >
        {saving && (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        )}
        Change my choices
      </button>
    </section>
  );
}

function ConsensusResult({
  data,
  onOrganise,
}: {
  data: CandidateResponse;
  onOrganise: () => void;
}) {
  const tiers = consensusTiers(data.selected, data.selectionMembers.length);

  function tier(
    title: string,
    description: string,
    places: RankedCandidate[],
    startIndex: number,
  ) {
    return (
      <section className="mt-10">
        <h2 className="font-editorial text-3xl font-medium tracking-[-0.035em]">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-warm-muted">{description}</p>
        {places.length ? (
          <ol className="mt-5 space-y-3">
            {places.map((place, index) => (
              <li
                key={place.id}
                className="flex items-center gap-4 rounded-xl border border-warm-border bg-paper p-4 shadow-sm sm:p-5"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-parchment font-editorial text-lg text-brown-accent">
                  {String(startIndex + index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-ink">{place.name}</h3>
                  <p className="mt-1 text-sm text-warm-muted">
                    {[place.area, label(place.category)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1.5 text-xs font-semibold text-brown-accent">
                    {place.voteCount >= data.selectionMembers.length
                      ? 'Everyone in your group wants to visit this.'
                      : `${place.voteCount} of ${data.selectionMembers.length} travellers chose this.`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-5 rounded-xl border border-warm-border bg-paper p-5 text-sm text-warm-muted">
            No places are in this tier.
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      className="mx-auto w-full max-w-3xl"
      data-testid="consensus-result"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brown-accent">
        Group result
      </p>
      <h1 className="mt-4 font-editorial text-5xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl">
        Your group’s places.
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-8 text-warm-muted">
        Everyone has finished choosing. Shared priorities will receive scarce
        schedule capacity first, while geographic and timing constraints remain
        in control.
      </p>

      {tier(
        'Everyone wants these',
        'Unanimous choices from every planning member.',
        tiers.unanimous,
        0,
      )}
      {tier(
        'Also on someone’s list',
        'Chosen by at least one traveller without unanimous agreement.',
        tiers.additional,
        tiers.unanimous.length,
      )}

      <button
        type="button"
        disabled={!data.selected.length}
        onClick={onOrganise}
        className="mt-10 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-paper shadow-sm transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-45"
      >
        Organise our trip
        <ArrowRight className="size-4" aria-hidden="true" />
      </button>
    </section>
  );
}

function SelectedPlacesReview({
  data,
  pending,
  onBack,
  onComplete,
  onToggle,
  completionSaving,
  error,
}: {
  data: CandidateResponse;
  pending: Set<string>;
  onBack: () => void;
  onComplete: () => void;
  onToggle: (place: RankedCandidate) => Promise<boolean>;
  completionSaving: boolean;
  error: string | null;
}) {
  return (
    <section
      id="selected"
      className="mx-auto w-full max-w-3xl"
      data-testid="selected-places-review"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-warm-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Review choices
      </button>

      <h1 className="mt-6 font-editorial text-5xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl">
        {data.selected.length} {data.selected.length === 1 ? 'place' : 'places'}{' '}
        kept.
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-8 text-warm-muted">
        These are the places your group has kept so far. Everyone keeps control
        of their own choices.
      </p>

      {error && (
        <SystemNotice
          role="alert"
          className="mt-5 border-brown-accent/30"
          title="We couldn’t save your completion status."
          description={error}
        />
      )}

      {data.selected.length ? (
        <ol className="mt-8 space-y-3">
          {data.selected.map((place, index) => (
            <li
              key={place.id}
              className="flex items-center gap-4 rounded-xl border border-warm-border bg-paper p-4 shadow-sm sm:p-5"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-parchment font-editorial text-lg text-brown-accent">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-ink">
                  {place.name}
                </h2>
                <p className="mt-1 truncate text-sm text-warm-muted">
                  {[place.area, label(place.category)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-1 text-xs font-medium text-brown-accent">
                  {place.voteCount} of {place.totalMembers}{' '}
                  {place.totalMembers === 1 ? 'traveller' : 'travellers'} want
                  this
                </p>
              </div>
              {place.currentUserSelected && (
                <button
                  type="button"
                  disabled={pending.has(place.id)}
                  onClick={() => void onToggle(place)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-warm-border px-3 text-xs font-semibold text-warm-muted transition-colors hover:bg-parchment hover:text-ink disabled:cursor-wait disabled:opacity-60"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Undo my vote</span>
                  <span className="sm:hidden">Undo</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-8 rounded-2xl border border-warm-border bg-paper p-7 shadow-editorial">
          <h2 className="font-editorial text-2xl font-medium text-ink">
            No group selections yet.
          </h2>
          <p className="mt-2 text-sm leading-6 text-warm-muted">
            Nothing is missing. Return to the shortlist and keep the places that
            feel right for your group.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-warm-border bg-paper px-4 text-sm font-semibold text-ink hover:bg-parchment"
          >
            Review shortlist
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={completionSaving}
        onClick={onComplete}
        className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-paper shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment disabled:cursor-not-allowed disabled:opacity-45"
      >
        {completionSaving ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="size-4" aria-hidden="true" />
        )}
        I’m done reviewing
      </button>
    </section>
  );
}

function StayAreaPresentation({
  recommendation,
  selectedPlaceCount,
  onBack,
  onContinue,
}: {
  recommendation: StayAreaRecommendation;
  selectedPlaceCount: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const primary = recommendation.recommendedArea;

  return (
    <section
      className="mx-auto w-full max-w-2xl"
      data-testid="stay-area-presentation"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-warm-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Selected places
      </button>

      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-brown-accent">
        Where to base yourselves
      </p>

      {recommendation.status === 'ready' && primary ? (
        <>
          <h1 className="mt-4 font-editorial text-5xl font-medium leading-[0.98] tracking-[-0.055em] sm:text-7xl">
            Stay in{' '}
            <em className="font-normal text-brown-accent">{primary.area}.</em>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-warm-muted">
            A practical base for the places your group chose, without turning
            this into a hotel decision.
          </p>

          <div className="mt-9 rounded-2xl border border-warm-border bg-paper p-6 shadow-editorial sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brown-accent">
              Why this area
            </p>
            <ul className="mt-6 space-y-6">
              {stayAreaEvidence(
                recommendation,
                primary.area,
                selectedPlaceCount,
              ).map((reason, index) => (
                <li key={reason} className="flex gap-4">
                  <span
                    className={
                      'mt-1.5 size-3 shrink-0 rounded-full border ' +
                      (index === 0
                        ? 'border-brown-accent bg-brown-accent shadow-[inset_0_0_0_3px_var(--journey-paper)]'
                        : 'border-brown-accent/60')
                    }
                    aria-hidden="true"
                  />
                  <p className="leading-7 text-ink">{reason}</p>
                </li>
              ))}
            </ul>
          </div>

          {recommendation.alternativeArea && (
            <aside className="mt-5 rounded-2xl border border-warm-border bg-transparent p-6 sm:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warm-muted">
                Another possible base
              </p>
              <h2 className="mt-2 font-editorial text-2xl font-medium tracking-[-0.03em] text-ink">
                {recommendation.alternativeArea.area}
              </h2>
              <p className="mt-2 leading-7 text-warm-muted">
                The next-closest real area across the places your group chose.
                {recommendation.alternativeArea.selectedPlaceCount > 0
                  ? ' ' +
                    recommendation.alternativeArea.selectedPlaceCount +
                    ' selected ' +
                    (recommendation.alternativeArea.selectedPlaceCount === 1
                      ? 'place is'
                      : 'places are') +
                    ' already in this area.'
                  : ''}
              </p>
            </aside>
          )}

          <button
            type="button"
            onClick={onContinue}
            className="mt-8 inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-paper shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
          >
            Plan from {primary.area}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </>
      ) : (
        <StayAreaUnavailable recommendation={recommendation} onBack={onBack} />
      )}
    </section>
  );
}

function StayAreaUnavailable({
  recommendation,
  onBack,
}: {
  recommendation: StayAreaRecommendation;
  onBack: () => void;
}) {
  const message =
    recommendation.status === 'no_selection'
      ? 'Choose at least one place before planning where to stay.'
      : recommendation.status === 'coordinate_data_unavailable'
        ? 'The selected places do not have enough location data for a stay-area recommendation.'
        : 'No verified area data is available for these selected places yet.';

  return (
    <div className="mt-5 rounded-2xl border border-warm-border bg-paper p-7 shadow-editorial sm:p-9">
      <h1 className="font-editorial text-4xl font-medium tracking-[-0.04em]">
        No stay area recommendation yet.
      </h1>
      <p className="mt-4 leading-7 text-warm-muted">
        {message} Your selected places are still saved.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink/90"
      >
        Review selected places
      </button>
    </div>
  );
}

function stayAreaEvidence(
  recommendation: StayAreaRecommendation,
  area: string,
  selectedPlaceCount: number,
) {
  const primary = recommendation.recommendedArea;
  if (!primary) return [];

  const evidence: string[] = [];
  if (primary.selectedPlaceCount > 0) {
    evidence.push(
      selectedPlaceCount === 1
        ? 'Your selected place is already in ' + area + '.'
        : primary.selectedPlaceCount +
            ' of the ' +
            selectedPlaceCount +
            ' places your group selected ' +
            (primary.selectedPlaceCount === 1 ? 'is' : 'are') +
            ' already in ' +
            area +
            '.',
    );
  }

  evidence.push(
    recommendation.alternativeArea
      ? area +
          ' keeps the combined distance to your selected places lower than the other available areas.'
      : area +
          ' is the available area closest to the places your group selected.',
  );

  if (recommendation.spreadKm !== null) {
    evidence.push(
      'Your chosen places have an overall spread of about ' +
        recommendation.spreadKm +
        ' km, which shapes how strongly this base is recommended.',
    );
  }

  if (recommendation.excludedPlaceCount > 0) {
    evidence.push(
      recommendation.excludedPlaceCount +
        ' selected ' +
        (recommendation.excludedPlaceCount === 1
          ? 'place was'
          : 'places were') +
        ' not included because location data is missing.',
    );
  }

  return evidence.slice(0, 4);
}

function formatDuration(minutes: number) {
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? hours + 'h ' + remainder + 'm' : hours + 'h';
}

function transitionStart(startTime: string, transitionMinutes: number) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = Math.max(0, hours * 60 + minutes - transitionMinutes);
  return (
    String(Math.floor(totalMinutes / 60)).padStart(2, '0') +
    ':' +
    String(totalMinutes % 60).padStart(2, '0')
  );
}

function scheduleReason(reason: string) {
  if (reason.startsWith('Uses ') || reason.includes('Haversine transition')) {
    return null;
  }

  const preferredTime = reason.match(
    /Scheduled later to prefer its (morning|afternoon|evening) best-time setting\./,
  )?.[1];
  if (preferredTime === 'morning') return 'Best earlier in the day';
  if (preferredTime === 'afternoon') return 'Best in the afternoon';
  if (preferredTime === 'evening') return 'Best later in the day';

  const priorPlace = reason.match(
    /Placed after (.+) using geographic proximity and group priority\./,
  )?.[1];
  if (priorPlace) return 'Kept near ' + priorPlace + ' for an easier day';

  const stayArea = reason.match(/recommended (.+) stay area\./)?.[1];
  if (stayArea) {
    return 'The day starts from your recommended ' + stayArea + ' base';
  }

  return null;
}

function breakReason(reason: string) {
  if (reason.startsWith('A generic meal window')) {
    return 'A meal break is reserved because no selected food stop fills this window.';
  }

  const selectedStop = reason.match(
    /^(.+) is a selected food-related stop that satisfies the (lunch|dinner) window\.$/,
  );
  if (selectedStop) {
    return selectedStop[1] + ' also covers the ' + selectedStop[2] + ' break.';
  }

  return null;
}

function dayAreaLabel(grouping: GeographicDayClustering, day: number) {
  const group = grouping.days.find((candidate) => candidate.day === day);
  const areas = [
    ...new Set(
      (group?.places ?? [])
        .map((place) => place.area?.trim())
        .filter((area): area is string => Boolean(area)),
    ),
  ];
  return areas.length ? areas.join(' · ') : null;
}

function SchedulePresentation({
  destination,
  durationDays,
  grouping,
  recommendation,
  schedule,
  onBack,
  hasPersistedItinerary,
  scheduleMatchesPersistedItinerary,
  saving,
  error,
  replacementWarning,
  isHost,
  onOpenMap,
  onCancelReplacement,
  onConfirmReplacement,
}: {
  destination: string;
  durationDays: number | null;
  grouping: GeographicDayClustering;
  recommendation: StayAreaRecommendation;
  schedule: DeterministicDraftSchedule;
  onBack: () => void;
  hasPersistedItinerary: boolean;
  scheduleMatchesPersistedItinerary: boolean;
  saving: boolean;
  error: string | null;
  replacementWarning: boolean;
  isHost: boolean;
  onOpenMap: () => void;
  onCancelReplacement: () => void;
  onConfirmReplacement: () => void;
}) {
  const [activeDay, setActiveDay] = useState(schedule.days[0]?.day ?? 1);
  const day =
    schedule.days.find((candidate) => candidate.day === activeDay) ??
    schedule.days[0];
  const areaLabel = day ? dayAreaLabel(grouping, day.day) : null;

  if (schedule.status === 'no_selection' || !day) {
    return (
      <section className="mx-auto w-full max-w-3xl">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-warm-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Stay area
        </button>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-brown-accent">
          Your trip plan
        </p>
        <div className="mt-5 rounded-2xl border border-warm-border bg-paper p-7 shadow-editorial sm:p-9">
          <h1 className="font-editorial text-4xl font-medium tracking-[-0.04em]">
            No schedule yet.
          </h1>
          <p className="mt-4 text-base leading-7 text-warm-muted">
            Choose at least one place first. Your trip is safe, and the schedule
            can arrange your selections into a practical day when you return.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink/90"
          >
            Review stay area
          </button>
        </div>
      </section>
    );
  }

  const timelineEntries = [
    ...day.items.map((item, index) => ({
      kind: 'place' as const,
      startTime: item.startTime,
      item,
      index,
    })),
    ...day.breaks
      .filter(
        (meal) =>
          !day.items.some(
            (item) =>
              item.startTime === meal.startTime &&
              item.endTime === meal.endTime,
          ),
      )
      .map((meal) => ({
        kind: 'meal' as const,
        startTime: meal.startTime,
        meal,
      })),
  ].sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) || a.kind.localeCompare(b.kind),
  );

  return (
    <section
      className="mx-auto w-full max-w-4xl"
      data-testid="schedule-presentation"
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-warm-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Stay area
      </button>

      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-brown-accent">
        Your trip plan
      </p>
      <h1 className="mt-4 font-editorial text-5xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl">
        {durationDays
          ? durationDays + ' days in ' + destination + '.'
          : destination}
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-warm-muted">
        Nearby places grouped into practical days, with time for travel and meal
        breaks.
      </p>
      <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-warm-muted">
        <span className="inline-flex items-center gap-2">
          <CalendarDays
            className="size-4 text-brown-accent"
            aria-hidden="true"
          />
          {schedule.scheduledPlaceCount} planned
        </span>
        {schedule.overflowPlaceCount > 0 && (
          <span>{schedule.overflowPlaceCount} optional</span>
        )}
        {recommendation.recommendedArea && (
          <span>Starting from {recommendation.recommendedArea.area}</span>
        )}
      </p>

      <div
        className="mt-8 flex gap-2 overflow-x-auto pb-2"
        aria-label="Choose a day"
      >
        {schedule.days.map((candidate) => (
          <button
            key={candidate.day}
            type="button"
            aria-pressed={candidate.day === day.day}
            onClick={() => setActiveDay(candidate.day)}
            className={
              'h-11 shrink-0 rounded-lg border px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 ' +
              (candidate.day === day.day
                ? 'border-ink bg-ink text-paper'
                : 'border-warm-border bg-paper text-warm-muted hover:text-ink')
            }
          >
            Day {candidate.day}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-[#dcc89a] bg-[#fff3c9] p-5 sm:p-6">
        <p className="font-editorial text-2xl font-medium tracking-[-0.03em] text-brown-accent">
          Day {day.day}
        </p>
        {areaLabel && (
          <p className="mt-1.5 font-medium text-ink">{areaLabel}</p>
        )}
        <p className="mt-2 text-sm text-warm-muted">
          Planned inside the existing {day.startTime}–{day.endTime} day window.
        </p>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-warm-border bg-paper shadow-editorial">
        <ol>
          {timelineEntries.map((entry) => {
            if (entry.kind === 'meal') {
              const meal = entry.meal;
              return (
                <li
                  key={meal.label + '-' + meal.startTime}
                  className="grid grid-cols-[4.5rem_1fr] border-b border-warm-border bg-[#fbf4e8] px-4 py-5 sm:grid-cols-[6rem_1fr] sm:px-6"
                >
                  <time className="font-mono text-sm text-warm-muted">
                    {meal.startTime}
                  </time>
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      <Utensils
                        className="size-4 text-brown-accent"
                        aria-hidden="true"
                      />
                      {meal.label}
                      <span className="rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-warm-muted">
                        {formatDuration(meal.durationMinutes)}
                      </span>
                    </p>
                    {breakReason(meal.reason) && (
                      <p className="mt-2 text-sm italic leading-6 text-warm-muted">
                        {breakReason(meal.reason)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-warm-muted">
                      Until {meal.endTime}
                    </p>
                  </div>
                </li>
              );
            }

            const { item, index } = entry;
            const attachedBreaks = day.breaks.filter(
              (meal) =>
                meal.startTime === item.startTime &&
                meal.endTime === item.endTime,
            );
            const reasons = item.schedulingReasons
              .map(scheduleReason)
              .filter((reason): reason is string => Boolean(reason))
              .slice(0, 2);

            return (
              <li key={item.placeId}>
                <div className="grid grid-cols-[4.5rem_1fr] border-b border-warm-border/80 px-4 py-3 text-sm text-warm-muted sm:grid-cols-[6rem_1fr] sm:px-6">
                  <span className="font-mono text-xs">
                    {transitionStart(
                      item.startTime,
                      item.estimatedTransitionMinutesBefore,
                    )}
                  </span>
                  <span className="inline-flex items-center gap-2 italic">
                    <Route
                      className="size-3.5 text-brown-accent"
                      aria-hidden="true"
                    />
                    {item.estimatedTransitionMinutesBefore} min travel
                    {index === 0 && recommendation.recommendedArea
                      ? ' from ' + recommendation.recommendedArea.area
                      : ''}
                  </span>
                </div>

                <article className="grid grid-cols-[4.5rem_1fr] gap-0 border-b border-warm-border px-4 py-5 sm:grid-cols-[6rem_1fr] sm:px-6">
                  <time className="font-mono text-sm text-warm-muted">
                    {item.startTime}
                  </time>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-ink">{item.name}</h2>
                      <span className="rounded-full bg-parchment px-2.5 py-1 text-xs font-medium text-warm-muted">
                        {formatDuration(item.durationMinutes)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-warm-muted">
                      Until {item.endTime}
                    </p>

                    {attachedBreaks.map((meal) => (
                      <div
                        key={meal.label + '-' + meal.startTime}
                        className="mt-3 flex items-start gap-2 text-sm text-brown-accent"
                      >
                        <Utensils
                          className="mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          <strong>{meal.label}</strong>
                          {breakReason(meal.reason)
                            ? ' · ' + breakReason(meal.reason)
                            : ''}
                        </span>
                      </div>
                    ))}

                    {reasons.map((reason) => (
                      <p
                        key={reason}
                        className="mt-2 text-sm italic leading-6 text-warm-muted"
                      >
                        {reason}
                      </p>
                    ))}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </div>

      {day.overflow.length > 0 && (
        <aside className="mt-6 rounded-2xl border border-warm-border bg-transparent p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brown-accent">
            Optional, if you have time
          </p>
          <ul className="mt-4 divide-y divide-warm-border">
            {day.overflow.map((item) => (
              <li
                key={item.placeId}
                className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div>
                  <h2 className="font-semibold text-ink">{item.name}</h2>
                  <p className="mt-1 text-sm leading-6 text-warm-muted">
                    It did not fit comfortably after the higher-priority stops,
                    travel time, and meal breaks.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-paper px-3 py-1.5 text-xs font-medium text-warm-muted">
                  {formatDuration(item.durationMinutes)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="mt-8">
        {replacementWarning && (
          <div
            role="alertdialog"
            aria-labelledby="replace-map-plan-title"
            aria-describedby="replace-map-plan-description"
            className="mb-5 rounded-2xl border border-brown-accent/30 bg-[#fbf4e8] p-5 sm:p-6"
          >
            <h2
              id="replace-map-plan-title"
              className="font-editorial text-2xl font-medium tracking-[-0.03em] text-ink"
            >
              Update your map plan?
            </h2>
            <p
              id="replace-map-plan-description"
              className="mt-2 text-sm leading-6 text-warm-muted"
            >
              Your current map edits will be replaced with this newly organised
              schedule.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={onConfirmReplacement}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40 disabled:cursor-wait disabled:opacity-60"
              >
                {saving ? 'Updating…' : 'Update map plan'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onCancelReplacement}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-warm-border bg-paper px-5 text-sm font-semibold text-ink transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <SystemNotice
            role="alert"
            className="mb-5 border-brown-accent/30"
            title="We couldn’t update the map plan."
            description={
              <>
                <p>{error}</p>
                <p className="mt-1">
                  Your current itinerary is still saved. Try opening the map
                  plan again.
                </p>
              </>
            }
          />
        )}

        {isHost ? (
          <button
            type="button"
            disabled={saving}
            onClick={onOpenMap}
            aria-describedby="map-handoff-note"
            className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-paper shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? (
              <>
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                Finalizing trip
              </>
            ) : (
              <>
                Finalize and open map
                <ArrowRight className="size-4" aria-hidden="true" />
              </>
            )}
          </button>
        ) : (
          <SystemNotice
            title="Waiting for the trip organiser"
            description="The shared schedule is ready. The trip host will confirm the final map plan, and this page will update automatically."
          />
        )}
        <p
          id="map-handoff-note"
          className="mx-auto mt-3 max-w-xl text-center text-sm leading-6 text-warm-muted"
        >
          {!isHost
            ? 'Your votes and the shared schedule are saved.'
            : scheduleMatchesPersistedItinerary
              ? 'This schedule is already saved, so your current map plan will open without replacing it.'
              : hasPersistedItinerary
                ? 'Confirming this schedule may replace changes made in your current map plan.'
                : 'Only the planned real places will be saved. Meal breaks and optional places stay here.'}
        </p>
      </div>
    </section>
  );
}
