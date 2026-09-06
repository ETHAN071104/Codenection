'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Check,
  MapPin,
  Pencil,
  RefreshCw,
  Star,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { SystemLoading, SystemState } from '@/components/ui/system-state';
import {
  INTERESTS,
  formatMyr,
  getPreferenceError,
  paceSummaryLabel,
  parseAverageInterests,
  type GroupPreferenceSummary,
  type QuestionnaireStatusRow,
} from '@/lib/preferences/model';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { JourneyShell } from './journey-shell';
import { ReadinessList } from './readiness-list';

type SummaryScreen = 'loading' | 'locked' | 'ready' | 'error';

type TripContext = {
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
};

function formatTripDates(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return null;

  const parseDate = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day));
  };
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;

  const dateFormat = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year:
      start.getUTCFullYear() === end.getUTCFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  const endFormat = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return `${dateFormat.format(start)} – ${endFormat.format(end)}`;
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'T';
}

export function GroupSummary({ tripId }: { tripId: string }) {
  const [screen, setScreen] = useState<SummaryScreen>('loading');
  const [status, setStatus] = useState<QuestionnaireStatusRow[]>([]);
  const [summary, setSummary] = useState<GroupPreferenceSummary | null>(null);
  const [trip, setTrip] = useState<TripContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setScreen('loading');
    setError(null);

    try {
      await ensureAnonymousUser();
      const supabase = getSupabaseBrowserClient();
      const [statusResult, membersResult, tripResult] = await Promise.all([
        supabase.rpc('get_questionnaire_status', { p_trip_id: tripId }),
        supabase
          .from('trip_members')
          .select('id, user_id')
          .eq('trip_id', tripId),
        supabase
          .from('trips')
          .select('destination, start_date, end_date, duration_days')
          .eq('id', tripId)
          .maybeSingle(),
      ]);
      if (statusResult.error) throw statusResult.error;
      if (membersResult.error) throw membersResult.error;
      if (tripResult.error) throw tripResult.error;

      setTrip(tripResult.data);
      const memberIds = new Map(
        (membersResult.data ?? []).map((member) => [member.id, member.user_id]),
      );
      const statusRows = (statusResult.data ?? []).map((row) => ({
        ...row,
        user_id: memberIds.get(row.member_id),
      }));
      setStatus(statusRows);
      if (!statusRows[0]?.all_completed) {
        setScreen('locked');
        return;
      }

      const { data: summaryData, error: summaryError } = await supabase.rpc(
        'get_group_preference_summary',
        { p_trip_id: tripId },
      );
      if (summaryError) throw summaryError;

      const row = summaryData?.[0];
      const averageInterests = row
        ? parseAverageInterests(row.average_interests)
        : null;
      if (!row || !averageInterests) throw new Error('INVALID_SUMMARY');

      setSummary({
        finite_budget_average:
          row.finite_budget_average === null
            ? null
            : Number(row.finite_budget_average),
        unlimited_members: Number(row.unlimited_members),
        average_pace: Number(row.average_pace),
        average_interests: averageInterests,
      });
      setScreen('ready');
    } catch (summaryError) {
      setError(getPreferenceError(summaryError));
      setScreen('error');
    }
  }, [tripId]);

  useEffect(() => {
    void Promise.resolve().then(loadSummary);
  }, [loadSummary]);

  if (screen === 'loading') {
    return (
      <JourneyShell tripId={tripId}>
        <SystemLoading
          title="Preparing your group summary"
          description="We’re combining the group’s completed Travel DNA into one shared picture."
        />
      </JourneyShell>
    );
  }

  if (screen === 'error') {
    return (
      <JourneyShell tripId={tripId}>
        <SystemState
          role="alert"
          eyebrow="Group summary"
          title="We could not load the group picture."
          description={
            <>
              <p>{error}</p>
              <p className="mt-2">
                Your group’s saved Travel DNA has not been changed.
              </p>
            </>
          }
          actions={
            <>
              <Button
                type="button"
                className="h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90"
                onClick={() => void loadSummary()}
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
      </JourneyShell>
    );
  }

  if (screen === 'locked') {
    const total = status[0]?.total_members ?? status.length;
    const completed = status[0]?.completed_members ?? 0;

    return (
      <JourneyShell tripId={tripId}>
        <section className="mx-auto w-full max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brown-accent">
            Group summary · {completed} of {total} ready
          </p>
          <h1 className="mt-4 max-w-2xl font-editorial text-5xl font-medium leading-[0.98] tracking-[-0.055em] sm:text-6xl">
            The group picture is still forming.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-warm-muted">
            This summary unlocks when everyone completes their Travel DNA.
          </p>
          <ReadinessList rows={status} />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/trip/${tripId}/questionnaire`}
              className={buttonVariants({
                className:
                  'h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90',
              })}
            >
              Continue Travel DNA
              <ArrowRight aria-hidden="true" />
            </Link>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-warm-border bg-paper px-5 text-ink hover:bg-parchment"
              onClick={() => void loadSummary()}
            >
              <RefreshCw aria-hidden="true" />
              Refresh status
            </Button>
          </div>
        </section>
      </JourneyShell>
    );
  }

  if (!summary) return null;

  const sortedInterests = INTERESTS.map(({ key, label }) => ({
    key,
    label,
    rating: summary.average_interests[key],
  }))
    .sort((a, b) => b.rating - a.rating || a.label.localeCompare(b.label))
    .slice(0, 3);

  const budgetText =
    summary.finite_budget_average === null
      ? 'Flexible budget'
      : `${formatMyr(summary.finite_budget_average)} / person`;
  const totalMembers = status[0]?.total_members ?? status.length;
  const tripDates = formatTripDates(
    trip?.start_date ?? null,
    trip?.end_date ?? null,
  );
  const tripTiming = [
    trip?.duration_days ? `${trip.duration_days} days` : null,
    tripDates,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <JourneyShell tripId={tripId}>
      <section className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex -space-x-2" aria-hidden="true">
            {status.slice(0, 4).map((member, index) => (
              <span
                key={member.member_id}
                className={`flex size-9 items-center justify-center rounded-full border-2 border-parchment text-xs font-bold ${
                  index % 2 === 0
                    ? 'bg-ink text-paper'
                    : 'bg-[#d9c8b8] text-ink'
                }`}
              >
                {getInitial(member.display_name)}
              </span>
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brown-accent">
            <Check className="size-4" aria-hidden="true" />
            All {totalMembers} {totalMembers === 1 ? 'traveller' : 'travellers'}{' '}
            responded
          </span>
        </div>

        <h1 className="mt-7 max-w-3xl font-editorial text-5xl font-medium leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
          Your group is aligned.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-warm-muted">
          Here is what your group has in common. Individual answers stay
          private.
        </p>

        <div className="mt-10 overflow-hidden rounded-2xl border border-warm-border bg-paper shadow-editorial">
          {trip?.destination && (
            <article className="border-b border-warm-border px-6 py-6 sm:px-8 sm:py-7">
              <div className="flex items-start gap-4">
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-parchment text-brown-accent">
                  <MapPin className="size-4.5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-warm-muted">
                    Destination
                  </p>
                  <h2 className="mt-1.5 font-editorial text-2xl font-medium tracking-[-0.025em] sm:text-3xl">
                    {trip.destination}
                  </h2>
                  {tripTiming && (
                    <p className="mt-1.5 inline-flex items-center gap-2 text-sm text-warm-muted">
                      <CalendarDays className="size-4" aria-hidden="true" />
                      {tripTiming}
                    </p>
                  )}
                </div>
              </div>
            </article>
          )}

          <div className="grid sm:grid-cols-2">
            <article className="border-b border-warm-border px-6 py-6 sm:border-r sm:px-8 sm:py-7">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-warm-muted">
                Group budget
              </p>
              <p className="mt-2 font-editorial text-2xl font-medium tracking-[-0.025em]">
                {budgetText}
              </p>
              {summary.unlimited_members > 0 &&
                summary.finite_budget_average !== null && (
                  <p className="mt-1.5 text-sm text-warm-muted">
                    {summary.unlimited_members}{' '}
                    {summary.unlimited_members === 1
                      ? 'traveller is'
                      : 'travellers are'}{' '}
                    flexible
                  </p>
                )}
            </article>

            <article className="border-b border-warm-border px-6 py-6 sm:px-8 sm:py-7">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-warm-muted">
                Group pace
              </p>
              <p className="mt-2 font-editorial text-2xl font-medium tracking-[-0.025em]">
                {paceSummaryLabel(summary.average_pace)}
              </p>
              <p className="mt-1.5 text-sm text-warm-muted">
                {summary.average_pace.toFixed(1)} average on your five-point
                pace scale
              </p>
            </article>
          </div>

          <article className="px-6 py-6 sm:px-8 sm:py-7">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-warm-muted">
              Top interests
            </p>
            <ol className="mt-4 flex flex-wrap gap-2.5">
              {sortedInterests.map((interest) => (
                <li
                  key={interest.key}
                  className="inline-flex items-center gap-2 rounded-full border border-warm-border bg-parchment px-4 py-2 text-sm font-semibold text-ink"
                >
                  {interest.label}
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-brown-accent">
                    {interest.rating.toFixed(1)}
                    <Star className="size-3 fill-current" aria-hidden="true" />
                  </span>
                </li>
              ))}
            </ol>
          </article>
        </div>

        <div className="mt-8">
          <Link
            href={`/trip/${tripId}/itinerary?step=destination`}
            className={buttonVariants({
              className:
                'h-12 w-full rounded-xl bg-ink px-6 text-paper shadow-sm hover:bg-ink/90',
            })}
          >
            Choose destination
            <ArrowRight aria-hidden="true" />
          </Link>
          <div className="mt-4 text-center">
            <Link
              href={`/trip/${tripId}/questionnaire`}
              className="inline-flex items-center gap-2 px-1 py-2 text-sm font-semibold text-warm-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown-accent/35 focus-visible:ring-offset-4 focus-visible:ring-offset-parchment"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit my preferences
            </Link>
          </div>
        </div>
      </section>
    </JourneyShell>
  );
}
