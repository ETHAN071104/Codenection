'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
  Star,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SystemLoading, SystemState } from '@/components/ui/system-state';
import {
  BUDGET_CUSTOM_POSITION,
  BUDGET_UNLIMITED_POSITION,
  CUSTOM_BUDGET_MAX,
  EMPTY_INTEREST_RATINGS,
  INTERESTS,
  PACE_LABELS,
  PRESET_BUDGETS,
  budgetForSliderPosition,
  formatMyr,
  getPreferenceError,
  isInterestRatings,
  parseCustomBudget,
  sliderPositionForBudget,
  type InterestKey,
  type InterestRatings,
  type QuestionnaireStatusRow,
} from '@/lib/preferences/model';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { AtlasShell } from './atlas-shell';
import { ReadinessList } from './readiness-list';

type Screen = 'loading' | 'wizard' | 'waiting' | 'error';

const STEP_DETAILS = {
  1: { eyebrow: 'PERSONAL BUDGET', label: 'Budget' },
  2: { eyebrow: 'TRAVEL TEMPO', label: 'Pace' },
  3: { eyebrow: 'INTEREST PRIORITIES', label: 'Interests' },
} as const;

const PACE_SHORT_LABELS = {
  1: 'Packed',
  2: 'Fast',
  3: 'Balanced',
  4: 'Chill',
  5: 'Relaxed',
} as const;

const INTEREST_RATING_LABELS = {
  1: 'Low priority',
  2: 'A little interest',
  3: 'Interested',
  4: 'Important',
  5: 'Top priority',
} as const;

export function QuestionnaireWizard({ tripId }: { tripId: string }) {
  const defaultBudgetPosition = PRESET_BUDGETS.indexOf(500) + 1;
  const [screen, setScreen] = useState<Screen>('loading');
  const [step, setStep] = useState(1);
  const [budgetPosition, setBudgetPosition] = useState(defaultBudgetPosition);
  const [customBudget, setCustomBudget] = useState('750');
  const [pace, setPace] = useState<keyof typeof PACE_LABELS>(3);
  const [interests, setInterests] = useState<InterestRatings>({
    ...EMPTY_INTEREST_RATINGS,
  });
  const [status, setStatus] = useState<QuestionnaireStatusRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasSavedPreferences, setHasSavedPreferences] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readinessChannelRef = useRef<RealtimeChannel | null>(null);

  const customBudgetValue = useMemo(
    () => parseCustomBudget(customBudget),
    [customBudget],
  );
  const allInterestsRated = INTERESTS.every(
    ({ key }) => interests[key] >= 1 && interests[key] <= 5,
  );
  const statusSummary = status[0];
  const unratedInterests = INTERESTS.filter(
    ({ key }) => interests[key] < 1 || interests[key] > 5,
  );
  const firstIncompleteInterest = unratedInterests[0]?.key;

  const loadStatus = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data, error: statusError } = await supabase.rpc(
      'get_questionnaire_status',
      { p_trip_id: tripId },
    );
    if (statusError) throw statusError;
    setStatus(data ?? []);
    return data ?? [];
  }, [tripId]);

  const loadQuestionnaire = useCallback(async () => {
    setScreen('loading');
    setError(null);

    try {
      await ensureAnonymousUser();
      const supabase = getSupabaseBrowserClient();
      const [profileResult, statusRows] = await Promise.all([
        supabase
          .from('preference_profiles')
          .select(
            'personal_budget, budget_unlimited, travel_pace, interests, completed_at',
          )
          .eq('trip_id', tripId)
          .maybeSingle(),
        loadStatus(),
      ]);

      if (profileResult.error) throw profileResult.error;

      const profile = profileResult.data;
      setHasSavedPreferences(Boolean(profile?.completed_at));
      if (profile) {
        const personalBudget =
          profile.personal_budget === null
            ? null
            : Number(profile.personal_budget);
        setBudgetPosition(
          sliderPositionForBudget(personalBudget, profile.budget_unlimited),
        );
        if (personalBudget !== null) setCustomBudget(String(personalBudget));
        if (profile.travel_pace && profile.travel_pace in PACE_LABELS) {
          setPace(profile.travel_pace as keyof typeof PACE_LABELS);
        }
        if (isInterestRatings(profile.interests)) {
          setInterests({ ...profile.interests });
        }
      }

      setScreen(profile?.completed_at ? 'waiting' : 'wizard');
      if (statusRows.length === 0) {
        throw new Error('NOT_TRIP_MEMBER');
      }
    } catch (loadError) {
      setError(getPreferenceError(loadError));
      setScreen('error');
    }
  }, [loadStatus, tripId]);

  useEffect(() => {
    void Promise.resolve().then(loadQuestionnaire);
  }, [loadQuestionnaire]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleStatusRefresh() {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadStatus().catch((statusError) => {
          setError(getPreferenceError(statusError));
        });
      }, 200);
    }

    const channel = supabase
      .channel(`travel-dna-readiness:${tripId}`)
      .on('broadcast', { event: 'readiness_changed' }, scheduleStatusRefresh)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'preference_profiles',
          filter: `trip_id=eq.${tripId}`,
        },
        scheduleStatusRefresh,
      )
      .subscribe();
    readinessChannelRef.current = channel;

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      if (readinessChannelRef.current === channel) {
        readinessChannelRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [loadStatus, tripId]);

  function goForward() {
    setError(null);

    if (step === 1 && budgetPosition === BUDGET_CUSTOM_POSITION) {
      if (customBudgetValue === null) {
        setError(
          `Enter a custom budget from RM 1 to RM ${CUSTOM_BUDGET_MAX.toLocaleString('en-MY')}.`,
        );
        return;
      }
    }

    if (step < 3) setStep((current) => current + 1);
  }

  function updateInterest(key: InterestKey, rating: number) {
    setInterests((current) => ({ ...current, [key]: rating }));
    setError(null);
  }

  async function submitPreferences() {
    if (!allInterestsRated) {
      setError('Rate every interest before submitting.');
      return;
    }

    const unlimited = budgetPosition === BUDGET_UNLIMITED_POSITION;
    const personalBudget =
      budgetPosition === BUDGET_CUSTOM_POSITION
        ? customBudgetValue
        : budgetForSliderPosition(budgetPosition);

    if (!unlimited && personalBudget === null) {
      setStep(1);
      setError('Choose a valid personal budget.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await ensureAnonymousUser();
      const supabase = getSupabaseBrowserClient();
      const { error: saveError } = await supabase.rpc(
        'save_preference_profile',
        {
          p_trip_id: tripId,
          p_personal_budget: unlimited ? null : personalBudget,
          p_budget_unlimited: unlimited,
          p_travel_pace: pace,
          p_interests: interests,
        },
      );
      if (saveError) throw saveError;

      await loadStatus();
      await readinessChannelRef.current?.send({
        type: 'broadcast',
        event: 'readiness_changed',
        payload: { tripId },
      });
      setHasSavedPreferences(true);
      setScreen('waiting');
    } catch (saveError) {
      setError(getPreferenceError(saveError));
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshStatus() {
    setRefreshing(true);
    setError(null);
    try {
      await loadStatus();
    } catch (statusError) {
      setError(getPreferenceError(statusError));
    } finally {
      setRefreshing(false);
    }
  }

  if (screen === 'loading') {
    return (
      <AtlasShell tripId={tripId} variant="travel-dna">
        <SystemLoading
          title="Loading your Travel DNA"
          description="We’re restoring your saved answers and the group’s readiness."
        />
      </AtlasShell>
    );
  }

  if (screen === 'error') {
    return (
      <AtlasShell tripId={tripId} variant="travel-dna">
        <SystemState
          role="alert"
          eyebrow="Travel DNA"
          title="We could not load your preferences."
          description={
            <>
              <p>{error}</p>
              <p className="mt-2">Any answers already saved are still safe.</p>
            </>
          }
          actions={
            <>
              <Button
                type="button"
                className="h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90"
                onClick={() => void loadQuestionnaire()}
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

  if (screen === 'waiting') {
    const total = statusSummary?.total_members ?? status.length;
    const completed = statusSummary?.completed_members ?? 0;
    const waiting = Math.max(total - completed, 0);
    const allCompleted = statusSummary?.all_completed ?? false;
    const waitingNames = status
      .filter((row) => !row.completed)
      .map((row) => row.display_name);
    const waitingFor =
      waitingNames.length === 1
        ? `Waiting for ${waitingNames[0]}.`
        : waitingNames.length === 2
          ? `Waiting for ${waitingNames[0]} and ${waitingNames[1]}.`
          : waitingNames.length > 2
            ? `Waiting for ${waitingNames.slice(0, -1).join(', ')}, and ${waitingNames.at(-1)}.`
            : '';

    return (
      <AtlasShell tripId={tripId} variant="travel-dna">
        <section className="mx-auto w-full max-w-3xl rounded-2xl border border-warm-border bg-paper p-6 shadow-editorial sm:p-10 lg:p-12">
          <div className="inline-flex size-12 items-center justify-center rounded-full bg-ink text-paper">
            <CircleCheck className="size-5" aria-hidden="true" />
          </div>
          <p className="mt-7 text-xs font-semibold tracking-[0.16em] text-brown-accent">
            PREFERENCES SAVED
          </p>
          <h1 className="mt-3 max-w-2xl font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
            {allCompleted
              ? 'Your group is ready.'
              : 'Your Travel DNA is ready.'}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-warm-muted">
            {completed} of {total} travellers ready.
            {!allCompleted &&
              ` ${waitingFor || `Waiting for ${waiting} ${waiting === 1 ? 'traveller' : 'travellers'}.`}`}
          </p>

          <div
            className="mt-7 h-1.5 overflow-hidden rounded-full bg-parchment"
            aria-label={`${completed} of ${total} travellers ready`}
          >
            <div
              className="h-full rounded-full bg-brown-accent transition-[width]"
              style={{
                width: `${total > 0 ? Math.round((completed / total) * 100) : 0}%`,
              }}
            />
          </div>

          <ReadinessList rows={status} />

          {error && (
            <Alert
              variant="destructive"
              className="mt-5 border-brown-accent/35 bg-parchment"
            >
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
            {allCompleted ? (
              <Link
                href={`/trip/${tripId}/summary`}
                className={buttonVariants({
                  className: 'h-12 bg-ink px-5 text-paper hover:bg-ink/85',
                })}
              >
                View group summary
                <ArrowRight aria-hidden="true" />
              </Link>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-11 border-warm-border bg-paper px-5 text-ink hover:bg-parchment"
                onClick={() => void refreshStatus()}
                disabled={refreshing}
              >
                <RefreshCw
                  className={refreshing ? 'animate-spin' : undefined}
                  aria-hidden="true"
                />
                Refresh status
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-5 text-warm-muted hover:bg-parchment hover:text-ink"
              onClick={() => {
                setStep(1);
                setError(null);
                setScreen('wizard');
              }}
            >
              Edit my preferences
            </Button>
          </div>
        </section>
      </AtlasShell>
    );
  }

  const budgetDisplay =
    budgetPosition === BUDGET_CUSTOM_POSITION
      ? customBudgetValue === null
        ? 'Custom budget'
        : formatMyr(customBudgetValue)
      : budgetPosition === BUDGET_UNLIMITED_POSITION
        ? 'No budget limit'
        : formatMyr(budgetForSliderPosition(budgetPosition) ?? 500);

  return (
    <AtlasShell tripId={tripId} step={step} variant="travel-dna">
      <section
        key={step}
        className="atlas-question-enter mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-warm-border bg-paper shadow-editorial"
        aria-live="polite"
      >
        <div className="border-b border-warm-border px-5 py-5 sm:px-8 lg:px-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
                {step} OF 3
              </p>
              <p className="mt-1 font-editorial text-xl font-semibold tracking-[-0.02em]">
                {STEP_DETAILS[step as keyof typeof STEP_DETAILS].label}
              </p>
            </div>
            <div className="flex gap-1.5" aria-hidden="true">
              {[1, 2, 3].map((item) => (
                <span
                  key={item}
                  className={`h-1.5 w-8 rounded-full ${
                    item <= step ? 'bg-brown-accent' : 'bg-warm-border'
                  }`}
                />
              ))}
            </div>
          </div>
          {hasSavedPreferences && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-warm-border bg-parchment px-3 py-1.5 text-xs font-semibold text-warm-muted">
              <Check
                className="size-3.5 text-brown-accent"
                aria-hidden="true"
              />
              Editing saved preferences
            </p>
          )}
        </div>

        <div
          className={`p-5 sm:p-8 lg:p-10 ${step === 3 ? 'pb-28 sm:pb-8 lg:pb-10' : ''}`}
        >
          {step === 1 && (
            <>
              <p className="text-xs font-semibold tracking-[0.14em] text-brown-accent">
                {STEP_DETAILS[1].eyebrow}
              </p>
              <h1 className="mt-3 max-w-3xl text-balance font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                What budget feels comfortable?
              </h1>
              <p className="mt-4 max-w-xl leading-7 text-warm-muted">
                Set a daily target in MYR, enter your own amount, or stay
                flexible.
              </p>

              <div className="mt-9 rounded-xl border border-warm-border bg-parchment p-5 sm:p-7">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.14em] text-warm-muted">
                      YOUR DAILY TARGET
                    </p>
                    <output className="mt-2 block font-editorial text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                      {budgetDisplay}
                    </output>
                  </div>
                  <span className="rounded-full bg-paper px-3 py-1.5 text-xs font-semibold text-brown-accent">
                    {budgetPosition === BUDGET_CUSTOM_POSITION
                      ? 'Custom amount'
                      : budgetPosition === BUDGET_UNLIMITED_POSITION
                        ? 'No limit selected'
                        : 'Slider preset'}
                  </span>
                </div>

                <label htmlFor="budget-position" className="sr-only">
                  Personal target budget
                </label>
                <input
                  id="budget-position"
                  className="atlas-range mt-9 w-full"
                  type="range"
                  min={BUDGET_CUSTOM_POSITION}
                  max={BUDGET_UNLIMITED_POSITION}
                  step={1}
                  value={budgetPosition}
                  aria-valuetext={budgetDisplay}
                  onChange={(event) => {
                    setBudgetPosition(Number(event.target.value));
                    setError(null);
                  }}
                />
                <div className="mt-3 flex justify-between text-[0.68rem] font-semibold tracking-[0.08em] text-warm-muted sm:text-xs">
                  <span>CUSTOM</span>
                  <span className="hidden sm:inline">
                    RM 150–RM 1,200 PRESETS
                  </span>
                  <span>NO LIMIT</span>
                </div>

                {budgetPosition === BUDGET_CUSTOM_POSITION && (
                  <div className="mt-7 max-w-sm">
                    <label
                      htmlFor="custom-budget"
                      className="text-sm font-medium"
                    >
                      Custom budget
                    </label>
                    <div className="mt-2 flex items-center rounded-lg border border-warm-border bg-paper focus-within:ring-2 focus-within:ring-brown-accent/35">
                      <span className="px-4 font-semibold text-warm-muted">
                        RM
                      </span>
                      <Input
                        id="custom-budget"
                        name="customBudget"
                        type="number"
                        inputMode="decimal"
                        min={1}
                        max={CUSTOM_BUDGET_MAX}
                        step="0.01"
                        value={customBudget}
                        onChange={(event) => {
                          setCustomBudget(event.target.value);
                          setError(null);
                        }}
                        aria-invalid={customBudgetValue === null}
                        className="h-12 border-0 bg-transparent px-0 text-lg shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <p className="mt-2 text-sm text-warm-muted">
                      Enter a positive amount up to RM 1,000,000.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-xs font-semibold tracking-[0.14em] text-brown-accent">
                {STEP_DETAILS[2].eyebrow}
              </p>
              <h1 className="mt-3 max-w-3xl text-balance font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                How should each day feel?
              </h1>
              <p className="mt-4 max-w-xl leading-7 text-warm-muted">
                Move from a packed itinerary to slower, open-ended days.
              </p>

              <div className="mt-9 rounded-xl border border-warm-border bg-parchment p-5 sm:p-7">
                <div className="flex flex-wrap items-end gap-3">
                  <output className="font-editorial text-5xl font-semibold tracking-[-0.05em]">
                    {pace} / 5
                  </output>
                  <span className="pb-1 text-lg text-warm-muted">
                    {PACE_LABELS[pace]}
                  </span>
                </div>
                <label htmlFor="travel-pace" className="sr-only">
                  Travel pace from packed to relaxed
                </label>
                <input
                  id="travel-pace"
                  className="atlas-range mt-9 w-full"
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={pace}
                  aria-valuetext={`${pace} of 5, ${PACE_LABELS[pace]}`}
                  onChange={(event) =>
                    setPace(
                      Number(event.target.value) as keyof typeof PACE_LABELS,
                    )
                  }
                />
                <div className="mt-3 flex justify-between gap-6 text-xs font-semibold tracking-[0.06em] text-warm-muted">
                  <span>MORE STOPS</span>
                  <span className="text-right">MORE REST</span>
                </div>

                <div className="mt-6 grid grid-cols-5 gap-1.5 sm:gap-2">
                  {([1, 2, 3, 4, 5] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={pace === value}
                      className={`min-h-14 rounded-lg border px-1.5 py-2 text-center text-[0.68rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-2 sm:text-xs ${
                        pace === value
                          ? 'border-ink bg-ink text-paper'
                          : 'border-warm-border bg-paper text-warm-muted hover:border-brown-accent/45 hover:text-ink'
                      }`}
                      onClick={() => setPace(value)}
                    >
                      <span className="block text-base">{value}</span>
                      <span className="mt-0.5 block truncate sm:whitespace-normal">
                        {PACE_SHORT_LABELS[value]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-xs font-semibold tracking-[0.14em] text-brown-accent">
                {STEP_DETAILS[3].eyebrow}
              </p>
              <h1 className="mt-3 max-w-3xl text-balance font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                What draws you into a city?
              </h1>
              <p className="mt-4 max-w-xl leading-7 text-warm-muted">
                Rate every category from one to five stars.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {INTERESTS.map(({ key, label }) => (
                  <fieldset
                    key={key}
                    aria-invalid={interests[key] === 0}
                    className={`min-w-0 rounded-xl border p-5 transition-colors sm:p-6 ${
                      interests[key] === 0
                        ? key === firstIncompleteInterest
                          ? 'border-brown-accent bg-parchment'
                          : 'border-warm-border bg-parchment/55'
                        : 'border-warm-border bg-paper'
                    }`}
                  >
                    <legend className="px-1 font-editorial text-lg font-semibold tracking-[-0.02em]">
                      {label}
                    </legend>
                    <div
                      className="mt-4 flex items-center gap-1"
                      role="radiogroup"
                    >
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <label
                          key={rating}
                          className={`flex size-11 cursor-pointer items-center justify-center rounded-full outline-none transition-all hover:-translate-y-0.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brown-accent/45 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-paper ${
                            rating === interests[key]
                              ? 'bg-ink text-paper shadow-sm'
                              : rating < interests[key]
                                ? 'bg-brown-accent/10 text-brown-accent'
                                : 'text-warm-muted/45 hover:bg-parchment hover:text-brown-accent'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`interest-${key}`}
                            value={rating}
                            checked={interests[key] === rating}
                            onChange={() => updateInterest(key, rating)}
                            className="sr-only"
                          />
                          <Star
                            className="size-6 sm:size-7"
                            fill={
                              rating <= interests[key] ? 'currentColor' : 'none'
                            }
                            aria-hidden="true"
                          />
                          <span className="sr-only">
                            {rating} {rating === 1 ? 'star' : 'stars'}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p
                      className={`mt-3 text-sm ${
                        interests[key] > 0
                          ? 'font-medium text-brown-accent'
                          : 'text-warm-muted'
                      }`}
                    >
                      {interests[key] > 0
                        ? `${interests[key]} of 5 · ${INTEREST_RATING_LABELS[interests[key] as keyof typeof INTEREST_RATING_LABELS]}`
                        : key === firstIncompleteInterest
                          ? 'Choose 1–5 stars to continue'
                          : 'Not rated yet'}
                    </p>
                  </fieldset>
                ))}
              </div>

              {!allInterestsRated && (
                <p className="mt-5 rounded-lg border border-brown-accent/25 bg-parchment px-4 py-3 text-sm font-medium text-ink">
                  Rate all interest categories to continue.{' '}
                  <span className="text-warm-muted">
                    {unratedInterests.length}{' '}
                    {unratedInterests.length === 1 ? 'category' : 'categories'}{' '}
                    remaining.
                  </span>
                </p>
              )}
            </>
          )}

          {error && (
            <Alert
              variant="destructive"
              className="mt-5 border-brown-accent/35 bg-parchment"
            >
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div
            className={`flex items-center justify-between gap-4 border-t border-warm-border bg-paper pt-6 ${
              step === 3
                ? 'fixed inset-x-4 bottom-4 z-20 rounded-xl border border-warm-border p-3 shadow-editorial sm:static sm:mt-8 sm:rounded-none sm:border-x-0 sm:border-b-0 sm:p-0 sm:shadow-none'
                : 'mt-8'
            }`}
          >
            {step > 1 ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-1 text-warm-muted hover:bg-transparent hover:text-ink"
                onClick={() => {
                  setError(null);
                  setStep((current) => current - 1);
                }}
              >
                <ChevronLeft aria-hidden="true" />
                Back
              </Button>
            ) : (
              <span />
            )}

            {step < 3 ? (
              <Button
                type="button"
                className="h-12 bg-ink px-6 text-paper hover:bg-ink/85"
                onClick={goForward}
                disabled={
                  step === 1 &&
                  budgetPosition === BUDGET_CUSTOM_POSITION &&
                  customBudgetValue === null
                }
              >
                Continue
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                className="h-12 bg-ink px-6 text-paper hover:bg-ink/85 disabled:border-warm-border disabled:bg-parchment disabled:text-warm-muted disabled:opacity-100"
                onClick={() => void submitPreferences()}
                disabled={submitting || !allInterestsRated}
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                Submit Travel DNA
              </Button>
            )}
          </div>
        </div>
      </section>
    </AtlasShell>
  );
}
