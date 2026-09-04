'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Clock3,
  LoaderCircle,
  MapPin,
  Sparkles,
  Star,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
type PendingAction = 'resolve' | 'suggest' | 'accept' | 'generate' | null;

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

export function ItineraryPlanner({ tripId }: { tripId: string }) {
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
        }),
      });
      if (
        acceptSpecificInput &&
        geographicScope &&
        payload.suggestion.inputWasSpecific
      ) {
        await saveDestination(payload.suggestion.destination, geographicScope);
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
        <div className="mx-auto flex items-center gap-3 text-[#5a5d61]">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Loading the trip itinerary
        </div>
      </AtlasShell>
    );
  }

  if (screen === 'error' || !data) {
    return (
      <AtlasShell tripId={tripId} sectionLabel="TRIP ITINERARY">
        <section className="mx-auto w-full max-w-xl border border-[#35383d]/35 bg-[#fffdf8] p-6 sm:p-9">
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">
            Itinerary unavailable
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

  if (data.itinerary) {
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

  return (
    <AtlasShell tripId={tripId} sectionLabel="TRIP ITINERARY">
      <section className="mx-auto w-full max-w-3xl rounded-xl border border-[#8b8170]/30 bg-[#fffdf8] p-6 shadow-[0_24px_70px_-48px_rgba(67,58,44,0.55)] sm:p-10">
        <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
          PLAN WITH REAL PLACES
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
          {data.trip.destination
            ? `Build ${data.trip.destination}`
            : 'Where do you want to go?'}
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-[#5a5d61]">
          {data.trip.destination
            ? `${formatTripDuration(data.trip.durationDays)} based on the group's shared budget, pace, and strongest interests.`
            : `Enter a country, state, region, or city. For broad areas, we’ll suggest a specific place inside it using the private group summary for this ${formatTripDuration(data.trip.durationDays)} trip.`}
        </p>

        {!data.trip.destination && !suggestion && (
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
              Country, state or city
            </label>
            <Input
              id="destination-input"
              value={destinationInput}
              onChange={(event) => setDestinationInput(event.target.value)}
              placeholder="Japan, Kedah or Kyoto"
              autoComplete="off"
              maxLength={120}
              className="mt-2 h-12 rounded-none border-[#35383d]/40 bg-[#fffdf8] px-4 focus-visible:border-[#2f3237] focus-visible:ring-[#2f3237]/20"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                type="submit"
                className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
                disabled={
                  pendingAction !== null || destinationInput.trim().length < 3
                }
              >
                {pendingAction === 'resolve' ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <MapPin aria-hidden="true" />
                )}
                Continue
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
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles aria-hidden="true" />
                )}
                Suggest for me
              </Button>
            </div>
          </form>
        )}

        {suggestion && !data.trip.destination && (
          <div className="mt-8 border-l-2 border-[#2f3237] bg-[#f2eee1] p-5 sm:p-6">
            <p className="text-sm font-semibold text-[#2f3237]">
              PROPOSED DESTINATION
            </p>
            <h2 className="mt-3 text-2xl font-semibold">
              {suggestion.destination}
            </h2>
            <p className="mt-3 leading-7 text-[#5a5d61]">{suggestion.reason}</p>
            {suggestionScope && (
              <p className="mt-4 text-sm text-[#5a5d61]">
                Your chosen area: {suggestionScope}
              </p>
            )}
          </div>
        )}

        {error && (
          <Alert
            variant="destructive"
            className="mt-6 rounded-none bg-[#fffdf8]"
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {data.trip.destination && (
          <fieldset className="mt-8 border-y border-[#35383d]/20 py-6">
            <legend className="text-sm font-semibold text-[#35383d]">
              How broad should this trip be?
            </legend>
            <p className="mt-2 text-sm leading-6 text-[#5a5d61]">
              Your base remains {data.trip.destination}. We will only use
              practical same-day excursions.
            </p>
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
                    <span className="block font-semibold">{option.label}</span>
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
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          {!data.trip.destination && suggestion && (
            <>
              <Button
                type="button"
                className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
                onClick={() => void acceptDestination()}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'accept' ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
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
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
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
                Choose myself
              </Button>
            </>
          )}
          {data.trip.destination && (
            <Button
              type="button"
              className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
              onClick={() => void generateItinerary()}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'generate' ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              Generate itinerary
            </Button>
          )}
          <Link
            href={`/trip/${tripId}/summary`}
            className={buttonVariants({
              variant: 'outline',
              className:
                'h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]',
            })}
          >
            Back to group summary
          </Link>
        </div>
      </section>
    </AtlasShell>
  );
}
