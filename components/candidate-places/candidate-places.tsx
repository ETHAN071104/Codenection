'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Heart,
  LoaderCircle,
  MapPin,
  Minus,
  Route,
  RotateCcw,
  Star,
  Utensils,
  Users,
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
import type { StayAreaRecommendation } from '@/lib/malaysia-places/stay-area-core';
import { phase2Fetch } from '@/lib/phase2/client';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type CandidateResponse = {
  supported: boolean;
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
    [tripId],
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
            () => {
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
      router.push(`/trip/${tripId}/plan`);
    } catch (confirmationError) {
      if (
        confirmationError instanceof MapPlanConfirmationError &&
        confirmationError.code === 'SCHEDULE_CHANGED'
      ) {
        setReplacementWarning(false);
        await load(false);
        setMapPlanError(
          "Your group's choices changed while you were reviewing. We've refreshed the schedule—please check it and open the map again.",
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
          eyebrow="Choose places"
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
                Plan it for me with AI
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
          eyebrow="Choose places"
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
                  Plan it for me with AI
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
          onOrganise={() => setView('stay')}
          onToggle={toggle}
        />
      </JourneyShell>
    );
  }

  return (
    <JourneyShell tripId={tripId} currentStep="Places">
      <section
        className="mx-auto w-full max-w-xl"
        data-testid="choose-places"
        data-realtime-status={realtimeStatus}
      >
        <div className="flex items-end justify-between gap-4 border-b border-warm-border pb-5">
          <div>
            <h1 className="font-editorial text-4xl font-medium tracking-[-0.045em]">
              Choose places
            </h1>
            <p className="mt-1.5 text-sm text-warm-muted" aria-live="polite">
              {activePlace ? currentIndex + 1 : 0} of {orderedCandidates.length}{' '}
              · {selectedByCurrentUser} selected by you
            </p>
          </div>
          <button
            type="button"
            onClick={() => setView('review')}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-warm-border bg-paper px-4 text-sm font-semibold text-ink shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
          >
            Done ({selectedByCurrentUser})
          </button>
        </div>

        {error && (
          <SystemNotice
            role="alert"
            className="mt-5 border-brown-accent/30"
            title={
              errorKind === 'mutation'
                ? 'That choice didn’t update.'
                : 'We couldn’t refresh the latest choices.'
            }
            description={
              errorKind === 'mutation'
                ? 'Your previous selections are still saved. Refresh to load the latest group choices.'
                : 'Your saved selections are safe. Refresh to try loading the latest group choices again.'
            }
            actions={
              <button
                type="button"
                onClick={() => void load(false)}
                className="font-semibold text-brown-accent underline-offset-4 hover:underline"
              >
                Refresh choices
              </button>
            }
          />
        )}

        {['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(realtimeStatus) && (
          <SystemNotice
            className="mt-5"
            title="Live updates are paused."
            description="Your saved choices are safe. Refresh to check the latest group votes and reconnect."
            actions={
              <button
                type="button"
                onClick={() => void load(false)}
                className="font-semibold text-brown-accent underline-offset-4 hover:underline"
              >
                Refresh
              </button>
            }
          />
        )}

        {activePlace ? (
          <div className="relative mt-7 pb-20">
            <div
              aria-hidden="true"
              className="absolute inset-x-6 bottom-[4.25rem] top-5 rotate-[2deg] rounded-2xl border border-warm-border bg-[#eee7dd]"
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-3 bottom-[4.75rem] top-2 -rotate-[1deg] rounded-2xl border border-warm-border bg-[#f8f4ee]"
            />

            <article
              key={activePlace.id}
              className="relative flex min-h-[430px] flex-col rounded-2xl border border-warm-border bg-paper p-6 shadow-editorial motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 sm:p-8"
            >
              <div className="flex items-start justify-between gap-5">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-parchment text-brown-accent">
                  <MapPin className="size-5" aria-hidden="true" />
                </span>
                {activePlace.googleRating !== null && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Star
                      className="size-4 fill-brown-accent text-brown-accent"
                      aria-hidden="true"
                    />
                    {activePlace.googleRating.toFixed(1)}
                    <span className="sr-only">Google rating</span>
                  </span>
                )}
              </div>

              <div className="mt-8">
                <h2 className="font-editorial text-4xl font-medium leading-[1.05] tracking-[-0.045em] sm:text-5xl">
                  {activePlace.name}
                </h2>
                {(activePlace.area || activePlace.category) && (
                  <p className="mt-3 text-sm font-medium text-warm-muted">
                    {[activePlace.area, label(activePlace.category)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>

              <ul className="mt-8 space-y-3 text-sm leading-6 text-warm-muted">
                {activePlace.reasons.slice(0, 3).map((reason) => (
                  <li key={reason} className="flex gap-3">
                    <Minus
                      className="mt-1 size-4 shrink-0 text-brown-accent"
                      aria-hidden="true"
                    />
                    <span>{humanReason(reason)}</span>
                  </li>
                ))}
                {activePlace.voteCount > 0 && (
                  <li className="flex gap-3 font-medium text-ink">
                    <Users
                      className="mt-1 size-4 shrink-0 text-brown-accent"
                      aria-hidden="true"
                    />
                    <span>
                      {activePlace.voteCount}{' '}
                      {activePlace.voteCount === 1
                        ? 'traveller wants'
                        : 'travellers want'}{' '}
                      this
                    </span>
                  </li>
                )}
              </ul>

              {activePlace.currentUserSelected && (
                <p className="mt-auto flex items-center gap-2 pt-8 text-sm font-semibold text-brown-accent">
                  <Check className="size-4" aria-hidden="true" />
                  This is on your list
                </p>
              )}
            </article>

            <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={advance}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-warm-border bg-paper px-4 text-sm font-semibold text-warm-muted shadow-sm transition-colors hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
              >
                <X className="size-4" aria-hidden="true" />
                Skip
              </button>
              <button
                type="button"
                aria-pressed={activePlace.currentUserSelected}
                disabled={pending.has(activePlace.id)}
                onClick={async () => {
                  if (await toggle(activePlace)) advance();
                }}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-paper shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment disabled:cursor-wait disabled:opacity-60"
              >
                {pending.has(activePlace.id) ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : activePlace.currentUserSelected ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Heart className="size-4" aria-hidden="true" />
                )}
                {activePlace.currentUserSelected ? 'Selected' : 'Want to go'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-7 rounded-2xl border border-warm-border bg-paper p-8 text-center shadow-editorial">
            {orderedCandidates.length > 0 ? (
              <Check
                className="mx-auto size-8 text-brown-accent"
                aria-hidden="true"
              />
            ) : (
              <MapPin
                className="mx-auto size-8 text-brown-accent"
                aria-hidden="true"
              />
            )}
            <h2 className="mt-4 font-editorial text-3xl font-medium">
              {orderedCandidates.length > 0
                ? 'You have reviewed every place.'
                : 'No place suggestions are available yet.'}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-warm-muted">
              {orderedCandidates.length > 0
                ? 'Your saved choices are ready to review.'
                : 'We could not find curated places for this trip. Your trip room and Travel DNA are still available.'}
            </p>
            {orderedCandidates.length > 0 ? (
              <button
                type="button"
                onClick={() => setView('review')}
                className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper"
              >
                Review selected places
              </button>
            ) : (
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-paper"
                >
                  Try again
                </button>
                <Link
                  href={`/trip/${tripId}/itinerary?step=destination`}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-warm-border bg-paper px-5 text-sm font-semibold text-ink hover:bg-parchment"
                >
                  Change destination
                </Link>
              </div>
            )}
          </div>
        )}
      </section>
    </JourneyShell>
  );
}

function SelectedPlacesReview({
  data,
  pending,
  onBack,
  onOrganise,
  onToggle,
}: {
  data: CandidateResponse;
  pending: Set<string>;
  onBack: () => void;
  onOrganise: () => void;
  onToggle: (place: RankedCandidate) => Promise<boolean>;
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
        chosen.
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-8 text-warm-muted">
        These are the places your group has selected so far. Everyone keeps
        control of their own choices.
      </p>

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
            Nothing is missing. Return to the cards and choose the places that
            feel right for your group.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-warm-border bg-paper px-4 text-sm font-semibold text-ink hover:bg-parchment"
          >
            Choose places
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={!data.selected.length}
        onClick={onOrganise}
        className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-paper shadow-sm transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/40 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment disabled:cursor-not-allowed disabled:opacity-45"
      >
        Organise our trip
        <ArrowRight className="size-4" aria-hidden="true" />
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
            A practical base for the places your group chose—without turning
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
            Optional — if you have time
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
              Saving map plan
            </>
          ) : (
            <>
              Open map plan
              <ArrowRight className="size-4" aria-hidden="true" />
            </>
          )}
        </button>
        <p
          id="map-handoff-note"
          className="mx-auto mt-3 max-w-xl text-center text-sm leading-6 text-warm-muted"
        >
          {scheduleMatchesPersistedItinerary
            ? 'This schedule is already saved, so your current map plan will open without replacing it.'
            : hasPersistedItinerary
              ? 'Confirming this schedule may replace changes made in your current map plan.'
              : 'Only the planned real places will be saved. Meal breaks and optional places stay here.'}
        </p>
      </div>
    </section>
  );
}
