'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Clock3,
  LoaderCircle,
  MapPin,
  Sparkles,
  Star,
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
import type {
  DestinationSuggestion,
  ExplorationPreference,
  ItineraryPageData,
  ItineraryView,
} from '@/lib/phase2/types';

type Screen = 'loading' | 'ready' | 'error';
export type PlanningStep = 'destination' | 'scope' | 'mode' | 'result';
type PendingAction =
  | 'resolve'
  | 'suggest'
  | 'accept'
  | 'scope'
  | 'generate'
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

function ItineraryResult({ itinerary }: { itinerary: ItineraryView }) {
  const placeCount = itinerary.days.reduce(
    (total, day) => total + day.items.length,
    0,
  );

  return (
    <section className="mx-auto w-full max-w-5xl">
      <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
        TRIP ITINERARY
      </p>
      <div className="mt-4 flex flex-col gap-4 border-b border-[#35383d]/30 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
            {itinerary.destination}
          </h1>
          <p className="mt-4 text-[#5a5d61]">
            {formatTripDuration(itinerary.durationDays)} with {placeCount} real
            places from Google Places.
          </p>
        </div>
        <span className="text-sm text-[#5a5d61]">Times are approximate.</span>
      </div>

      <div className="mt-10 space-y-12">
        {itinerary.days.map((day) => (
          <article key={day.day}>
            <div className="grid gap-2 sm:grid-cols-[90px_1fr] sm:items-baseline">
              <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
                DAY {day.day}
              </p>
              <h2 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                {day.theme}
              </h2>
              {day.area && (
                <p className="text-sm text-[#5a5d61]">
                  {day.mode === 'day_trip' ? 'Day trip area' : 'Base area'}:{' '}
                  {day.area}
                </p>
              )}
            </div>

            <ol className="mt-6 space-y-3">
              {day.items.map((item) => (
                <li
                  key={item.id}
                  className="grid gap-4 border border-[#8b8170]/30 bg-[#fffdf8] p-5 shadow-[0_20px_55px_-45px_rgba(67,58,44,0.55)] sm:grid-cols-[90px_1fr] sm:p-6"
                >
                  <time className="font-semibold text-[#2f3237]">
                    {item.plannedTime}
                  </time>
                  <div className="min-w-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="text-xl font-semibold tracking-[-0.025em]">
                        {item.place.name}
                      </h3>
                      {item.place.rating !== null && (
                        <p className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[#2f3237]">
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
                    {item.place.address && (
                      <p className="mt-2 inline-flex items-start gap-2 text-sm leading-6 text-[#5a5d61]">
                        <MapPin
                          className="mt-1 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        {item.place.address}
                      </p>
                    )}
                    <p className="mt-4 leading-7 text-[#3f4247]">
                      {item.reason}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#5a5d61]">
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

  function goToStep(step: PlanningStep, replace = false) {
    setError(null);
    setPlanningStep(step);
    const href = `/trip/${tripId}/itinerary?step=${step}`;
    if (replace) router.replace(href);
    else router.push(href);
  }

  const load = useCallback(async () => {
    setScreen('loading');
    setError(null);
    try {
      const payload = await phase2Fetch<ItineraryPageData>(
        `/api/trips/${tripId}/itinerary`,
      );
      setData(payload);
      setDestinationInput(payload.trip.destinationInput ?? '');
      setExplorationPreference(payload.trip.explorationPreference);
      const requestedStep = initialStepRef.current;
      if (
        (requestedStep === 'scope' || requestedStep === 'mode') &&
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
      setScreen('error');
    }
  }, [tripId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

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
      if (
        acceptSpecificInput &&
        geographicScope &&
        payload.suggestion.inputWasSpecific
      ) {
        await saveDestination(payload.suggestion.destination, geographicScope);
        goToStep('scope');
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
      goToStep('scope');
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

  async function generateItinerary() {
    setPendingAction('generate');
    setError(null);
    try {
      const payload = await phase2Fetch<ItineraryPageData>(
        `/api/trips/${tripId}/itinerary`,
        {
          method: 'POST',
          body: JSON.stringify({ explorationPreference }),
        },
      );
      setData(payload);
      goToStep('result', true);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'We could not generate this itinerary.',
      );
    } finally {
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

  if (planningStep === 'result' && data.itinerary) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="TRIP ITINERARY">
        <div className="w-full py-2">
          <ItineraryResult itinerary={data.itinerary} />
          <div className="mx-auto mt-10 flex w-full max-w-5xl flex-wrap gap-3 border-t border-[#35383d]/30 pt-7">
            <Link
              href={`/trip/${tripId}/plan`}
              className={buttonVariants({
                className:
                  'h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]',
              })}
            >
              Open map plan
              <MapPin aria-hidden="true" />
            </Link>
            <Link
              href={`/trip/${tripId}`}
              className={buttonVariants({
                className:
                  'h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]',
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
                  'h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]',
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

  return (
    <AtlasShell tripId={tripId} sectionLabel="TRIP PLANNING">
      <section className="mx-auto w-full max-w-3xl rounded-xl border border-[#8b8170]/30 bg-[#fffdf8] p-6 shadow-[0_24px_70px_-48px_rgba(67,58,44,0.55)] sm:p-10">
        <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
          {planningStep === 'destination'
            ? 'DESTINATION'
            : planningStep === 'scope'
              ? 'GEOGRAPHIC SCOPE'
              : 'PLANNING MODE'}
        </p>

        {planningStep === 'destination' && (
          <>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              Where do you want to go?
            </h1>
            <p className="mt-5 max-w-2xl leading-7 text-[#5a5d61]">
              Enter a city, state, region, or country. For broad areas, we can
              suggest a practical destination using the group summary for this{' '}
              {formatTripDuration(data.trip.durationDays)} trip.
            </p>

            {data.trip.destination && !editingDestination && (
              <div className="mt-8 border-l-2 border-[#2f3237] bg-[#f2eee1] p-5 sm:p-6">
                <p className="text-sm font-semibold text-[#2f3237]">
                  CURRENT DESTINATION
                </p>
                <h2 className="mt-3 text-2xl font-semibold">
                  {data.trip.destination}
                </h2>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
                    onClick={() => goToStep('scope')}
                  >
                    Continue
                    <ArrowRight aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]"
                    onClick={() => {
                      setDestinationInput(
                        data.trip.destinationInput ??
                          data.trip.destination ??
                          '',
                      );
                      setSuggestion(null);
                      setEditingDestination(true);
                    }}
                  >
                    Choose another
                  </Button>
                </div>
              </div>
            )}

            {destinationEditing && !suggestion && (
              <form
                className="mt-8"
                onSubmit={(event) => {
                  event.preventDefault();
                  const scope = destinationInput.trim().replace(/\s+/g, ' ');
                  if (scope.length >= 3) {
                    void suggestDestination(scope, true);
                  }
                }}
              >
                <label
                  htmlFor="destination-input"
                  className="text-sm font-semibold text-[#35383d]"
                >
                  City, state, region, or country
                </label>
                <Input
                  id="destination-input"
                  value={destinationInput}
                  onChange={(event) => setDestinationInput(event.target.value)}
                  placeholder="Johor Bahru, Kedah, or Japan"
                  autoComplete="off"
                  maxLength={120}
                  className="mt-2 h-12 rounded-none border-[#35383d]/40 bg-[#fffdf8] px-4 focus-visible:border-[#2f3237] focus-visible:ring-[#2f3237]/20"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
                    disabled={
                      pendingAction !== null ||
                      destinationInput.trim().length < 3
                    }
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
                    className="h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]"
                    onClick={() =>
                      void suggestDestination(
                        destinationInput.trim().replace(/\s+/g, ' ') || null,
                      )
                    }
                    disabled={pendingAction !== null}
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
            )}

            {suggestion && destinationEditing && (
              <div className="mt-8 border-l-2 border-[#2f3237] bg-[#f2eee1] p-5 sm:p-6">
                <p className="text-sm font-semibold text-[#2f3237]">
                  PROPOSED DESTINATION
                </p>
                <h2 className="mt-3 text-2xl font-semibold">
                  {suggestion.destination}
                </h2>
                <p className="mt-3 leading-7 text-[#5a5d61]">
                  {suggestion.reason}
                </p>
                {suggestionScope && (
                  <p className="mt-4 text-sm text-[#5a5d61]">
                    Your chosen area: {suggestionScope}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
                    onClick={() => void acceptDestination()}
                    disabled={pendingAction !== null}
                  >
                    {pendingAction === 'accept' ? (
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
                    className="h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]"
                    onClick={() => void suggestDestination(suggestionScope)}
                    disabled={pendingAction !== null}
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
                    className="h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]"
                    onClick={() => {
                      setSuggestion(null);
                      setError(null);
                    }}
                    disabled={pendingAction !== null}
                  >
                    Choose manually
                  </Button>
                </div>
              </div>
            )}

            <Link
              href={`/trip/${tripId}/summary`}
              className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#5a5d61] underline-offset-4 hover:text-[#25282d] hover:underline"
            >
              Back to group summary
            </Link>
          </>
        )}

        {planningStep === 'scope' && data.trip.destination && (
          <>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              How far should this trip reach?
            </h1>
            <p className="mt-5 max-w-2xl leading-7 text-[#5a5d61]">
              {data.trip.destination} remains the base. This choice is saved
              before you choose how the trip will be planned.
            </p>
            <fieldset className="mt-8 border-y border-[#35383d]/20 py-6">
              <legend className="text-sm font-semibold text-[#35383d]">
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
                      className={`border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3237]/30 ${
                        selected
                          ? 'border-[#2f3237] bg-[#2f3237] text-[#f8f4e8]'
                          : 'border-[#8b8170]/35 bg-[#fffdf8] text-[#35383d] hover:bg-[#f2eee1]'
                      }`}
                    >
                      <span className="block font-semibold">
                        {option.label}
                      </span>
                      <span
                        className={`mt-1 block text-sm leading-5 ${
                          selected ? 'text-[#f8f4e8]/80' : 'text-[#5a5d61]'
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
                className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
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
                className="h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]"
                onClick={() => goToStep('destination')}
                disabled={pendingAction !== null}
              >
                Back to destination
              </Button>
            </div>
          </>
        )}

        {planningStep === 'mode' && data.trip.destination && (
          <>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              How should we plan {data.trip.destination}?
            </h1>
            <p className="mt-5 max-w-2xl leading-7 text-[#5a5d61]">
              Choose places together for the full collaborative journey, or ask
              the existing AI planner to prepare a grounded itinerary now.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <Link
                href={`/trip/${tripId}/places`}
                className="group border border-[#2f3237] bg-[#2f3237] p-6 text-[#f8f4e8] transition-colors hover:bg-[#1f2227]"
              >
                <span className="block text-xs font-semibold tracking-[0.12em] text-[#f8f4e8]/65">
                  PRIMARY
                </span>
                <span className="mt-3 block text-2xl font-semibold">
                  Choose places together
                </span>
                <span className="mt-3 block text-sm leading-6 text-[#f8f4e8]/75">
                  Review grounded places, vote as a group, then organise the
                  selected places into a deterministic schedule.
                </span>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">
                  Start choosing
                  <ArrowRight
                    className="transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void generateItinerary()}
                disabled={pendingAction !== null}
                className="border border-[#8b8170]/35 bg-[#fffdf8] p-6 text-left text-[#35383d] transition-colors hover:bg-[#f2eee1] disabled:cursor-wait disabled:opacity-60"
              >
                <span className="block text-xs font-semibold tracking-[0.12em] text-[#5a5d61]">
                  QUICK PLAN
                </span>
                <span className="mt-3 block text-2xl font-semibold">
                  Plan it for me with AI
                </span>
                <span className="mt-3 block text-sm leading-6 text-[#5a5d61]">
                  Skip collaborative voting and use the existing grounded
                  itinerary generator.
                </span>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">
                  {pendingAction === 'generate' ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles aria-hidden="true" />
                  )}
                  {pendingAction === 'generate'
                    ? 'Generating itinerary'
                    : 'Use quick AI planning'}
                </span>
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-8 h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]"
              onClick={() => goToStep('scope')}
              disabled={pendingAction !== null}
            >
              Back to geographic scope
            </Button>
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
                  onClick={() => void generateItinerary()}
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
