'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  LoaderCircle,
  RefreshCw,
  Star,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [error, setError] = useState<string | null>(null);

  const customBudgetValue = useMemo(
    () => parseCustomBudget(customBudget),
    [customBudget],
  );
  const allInterestsRated = INTERESTS.every(
    ({ key }) => interests[key] >= 1 && interests[key] <= 5,
  );
  const statusSummary = status[0];

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
      <AtlasShell tripId={tripId}>
        <div className="mx-auto w-full max-w-3xl" aria-live="polite">
          <div className="h-4 w-28 animate-pulse bg-[#2f3237]/20" />
          <div className="mt-7 h-14 max-w-xl animate-pulse bg-[#2f3237]/15" />
          <div className="mt-10 h-28 animate-pulse border border-[#35383d]/20 bg-[#ede7d6]" />
          <span className="sr-only">Loading your Travel DNA</span>
        </div>
      </AtlasShell>
    );
  }

  if (screen === 'error') {
    return (
      <AtlasShell tripId={tripId}>
        <section className="mx-auto w-full max-w-xl border border-[#35383d]/35 bg-[#f7f3e8] p-6 sm:p-9">
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">
            Travel DNA unavailable
          </h1>
          <p className="mt-4 leading-7 text-[#5a5d61]">{error}</p>
          <Button
            type="button"
            className="mt-7 h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
            onClick={() => void loadQuestionnaire()}
          >
            Try again
          </Button>
        </section>
      </AtlasShell>
    );
  }

  if (screen === 'waiting') {
    const total = statusSummary?.total_members ?? status.length;
    const completed = statusSummary?.completed_members ?? 0;
    const waiting = Math.max(total - completed, 0);
    const allCompleted = statusSummary?.all_completed ?? false;

    return (
      <AtlasShell tripId={tripId}>
        <section className="mx-auto w-full max-w-3xl">
          <div className="inline-flex size-12 items-center justify-center border border-[#2f3237] text-[#2f3237]">
            <Check className="size-5" aria-hidden="true" />
          </div>
          <h1 className="mt-7 max-w-2xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
            {allCompleted ? 'Your group is ready.' : "You're ready."}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-[#5a5d61]">
            {completed} of {total} travellers have completed their Travel DNA.
            {!allCompleted &&
              ` Waiting for ${waiting} ${waiting === 1 ? 'traveller' : 'travellers'}.`}
          </p>

          <ReadinessList rows={status} />

          {error && (
            <Alert
              variant="destructive"
              className="mt-5 rounded-none bg-[#f7f3e8]"
            >
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            {allCompleted ? (
              <Link
                href={`/trip/${tripId}/summary`}
                className={buttonVariants({
                  className:
                    'h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]',
                })}
              >
                View group summary
                <ArrowRight aria-hidden="true" />
              </Link>
            ) : (
              <Button
                type="button"
                className="h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
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
              variant="outline"
              className="h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]"
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
    <AtlasShell tripId={tripId} step={step}>
      <section
        key={step}
        className="atlas-question-enter mx-auto w-full max-w-4xl rounded-xl border border-[#8b8170]/30 bg-[#fffdf8] p-5 shadow-[0_24px_70px_-48px_rgba(67,58,44,0.55)] sm:p-8 lg:p-10"
        aria-live="polite"
      >
        {step === 1 && (
          <>
            <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
              PERSONAL BUDGET
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
              What budget feels comfortable?
            </h1>
            <p className="mt-4 max-w-xl leading-7 text-[#5a5d61]">
              Set a daily target in MYR, enter your own amount, or stay
              flexible.
            </p>

            <div className="mt-10 border-y border-[#35383d]/30 py-8 sm:mt-14 sm:py-10">
              <output className="block text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                {budgetDisplay}
              </output>

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
              <div className="mt-3 flex justify-between text-xs font-semibold tracking-[0.08em] text-[#5a5d61]">
                <span>CUSTOM</span>
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
                  <div className="mt-2 flex items-center border border-[#35383d]/45 bg-[#f7f3e8] focus-within:ring-2 focus-within:ring-[#2f3237]">
                    <span className="px-4 font-semibold text-[#5a5d61]">
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
                      className="h-12 rounded-none border-0 bg-transparent px-0 text-lg shadow-none focus-visible:ring-0"
                    />
                  </div>
                  <p className="mt-2 text-sm text-[#5a5d61]">
                    Enter a positive amount up to RM 1,000,000.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
              TRAVEL TEMPO
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
              How should each day feel?
            </h1>
            <p className="mt-4 max-w-xl leading-7 text-[#5a5d61]">
              Move from a packed itinerary to slower, open-ended days.
            </p>

            <div className="mt-10 border-y border-[#35383d]/30 py-8 sm:mt-14 sm:py-10">
              <div className="flex items-end gap-4">
                <output className="text-5xl font-semibold tracking-[-0.05em]">
                  {pace} / 5
                </output>
                <span className="pb-1 text-lg text-[#5a5d61]">
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
              <div className="mt-3 flex justify-between gap-6 text-xs font-semibold tracking-[0.06em] text-[#5a5d61]">
                <span>MORE STOPS</span>
                <span className="text-right">MORE REST</span>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
              INTEREST PRIORITIES
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
              What draws you into a city?
            </h1>
            <p className="mt-4 max-w-xl leading-7 text-[#5a5d61]">
              Rate every category from one to five stars.
            </p>

            <div className="mt-9 grid border border-[#35383d]/30 bg-[#35383d]/30 sm:grid-cols-2">
              {INTERESTS.map(({ key, label }) => (
                <fieldset key={key} className="min-w-0 bg-[#f2eee1] p-5 sm:p-6">
                  <legend className="font-medium">{label}</legend>
                  <div className="mt-4 flex gap-1">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <label
                        key={rating}
                        className={`rounded-none p-1 outline-none transition-transform hover:-translate-y-0.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#2f3237] has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-[#f2eee1] ${
                          rating <= interests[key]
                            ? 'text-[#2f3237]'
                            : 'text-[#898d92]'
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
                          className="size-7"
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
                  <p className="mt-2 text-sm text-[#5a5d61]">
                    {interests[key] > 0
                      ? `${interests[key]} of 5`
                      : 'Not rated yet'}
                  </p>
                </fieldset>
              ))}
            </div>
          </>
        )}

        {error && (
          <Alert
            variant="destructive"
            className="mt-5 rounded-none border-[#a84a3f]/35 bg-[#f7f3e8]"
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          {step > 1 ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 rounded-none px-1 text-[#2f3237] hover:bg-transparent hover:opacity-65"
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
              className="h-11 rounded-none bg-[#2f3237] px-6 text-[#f8f4e8] hover:bg-[#1f2227]"
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
              className="h-11 rounded-none bg-[#2f3237] px-6 text-[#f8f4e8] hover:bg-[#1f2227]"
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
      </section>
    </AtlasShell>
  );
}
