'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Star,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { AtlasShell } from './atlas-shell';
import { ReadinessList } from './readiness-list';

type SummaryScreen = 'loading' | 'locked' | 'ready' | 'error';

export function GroupSummary({ tripId }: { tripId: string }) {
  const [screen, setScreen] = useState<SummaryScreen>('loading');
  const [status, setStatus] = useState<QuestionnaireStatusRow[]>([]);
  const [summary, setSummary] = useState<GroupPreferenceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setScreen('loading');
    setError(null);

    try {
      await ensureAnonymousUser();
      const supabase = getSupabaseBrowserClient();
      const [statusResult, membersResult] = await Promise.all([
        supabase.rpc('get_questionnaire_status', { p_trip_id: tripId }),
        supabase
          .from('trip_members')
          .select('id, user_id')
          .eq('trip_id', tripId),
      ]);
      if (statusResult.error) throw statusResult.error;
      if (membersResult.error) throw membersResult.error;

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
      <AtlasShell tripId={tripId}>
        <div
          className="mx-auto flex items-center gap-3 text-[#5a5d61]"
          aria-live="polite"
        >
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Preparing the group summary
        </div>
      </AtlasShell>
    );
  }

  if (screen === 'error') {
    return (
      <AtlasShell tripId={tripId}>
        <section className="mx-auto w-full max-w-xl border border-[#35383d]/35 bg-[#f7f3e8] p-6 sm:p-9">
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">
            Summary unavailable
          </h1>
          <p className="mt-4 leading-7 text-[#5a5d61]">{error}</p>
          <Button
            type="button"
            className="mt-7 h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
            onClick={() => void loadSummary()}
          >
            Try again
          </Button>
        </section>
      </AtlasShell>
    );
  }

  if (screen === 'locked') {
    const total = status[0]?.total_members ?? status.length;
    const completed = status[0]?.completed_members ?? 0;

    return (
      <AtlasShell tripId={tripId}>
        <section className="mx-auto w-full max-w-3xl">
          <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
            GROUP SUMMARY
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
            The group picture is still forming.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-[#5a5d61]">
            {completed} of {total} travellers are ready. The summary unlocks
            when everyone completes their Travel DNA.
          </p>
          <ReadinessList rows={status} />
          <Button
            type="button"
            className="mt-8 h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]"
            onClick={() => void loadSummary()}
          >
            <RefreshCw aria-hidden="true" />
            Refresh status
          </Button>
        </section>
      </AtlasShell>
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
      ? 'No shared budget limit'
      : `${formatMyr(summary.finite_budget_average)} / person`;

  return (
    <AtlasShell tripId={tripId}>
      <section className="mx-auto w-full max-w-5xl">
        <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
          GROUP SUMMARY
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
          A shared rhythm for the trip.
        </h1>
        <p className="mt-4 max-w-xl leading-7 text-[#5a5d61]">
          Private answers stay private. These values combine the whole group.
        </p>

        <div className="mt-10 grid border border-[#35383d]/30 bg-[#35383d]/30 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="bg-[#f2eee1] p-6 sm:p-8 lg:p-10">
            <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
              GROUP BUDGET
            </p>
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              {budgetText}
            </h2>
            {summary.unlimited_members > 0 &&
              summary.finite_budget_average !== null && (
                <p className="mt-3 text-[#5a5d61]">
                  {summary.unlimited_members}{' '}
                  {summary.unlimited_members === 1
                    ? 'traveller is'
                    : 'travellers are'}{' '}
                  flexible.
                </p>
              )}
          </article>

          <article className="bg-[#e7e0cd] p-6 sm:p-8 lg:p-10">
            <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
              GROUP PACE
            </p>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em]">
              {summary.average_pace.toFixed(1)} / 5
            </h2>
            <p className="mt-3 text-[#5a5d61]">
              {paceSummaryLabel(summary.average_pace)}
            </p>
          </article>

          <article className="bg-[#f7f3e8] p-6 sm:p-8 lg:col-span-2 lg:p-10">
            <p className="text-sm font-semibold tracking-[0.08em] text-[#2f3237]">
              TOP INTERESTS
            </p>
            <ol className="mt-6 grid gap-5 md:grid-cols-3">
              {sortedInterests.map((interest, index) => (
                <li
                  key={interest.key}
                  className="border-l border-[#35383d]/35 pl-4"
                >
                  <span className="text-sm text-[#5a5d61]">{index + 1}</span>
                  <h3 className="mt-1 font-medium">{interest.label}</h3>
                  <p className="mt-3 inline-flex items-center gap-2 text-2xl font-semibold">
                    {interest.rating.toFixed(2)}
                    <Star
                      className="size-5 fill-current text-[#2f3237]"
                      aria-hidden="true"
                    />
                    <span className="sr-only">out of 5 stars</span>
                  </p>
                </li>
              ))}
            </ol>
          </article>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/trip/${tripId}/itinerary`}
            className={buttonVariants({
              className:
                'h-11 rounded-none bg-[#2f3237] px-5 text-[#f8f4e8] hover:bg-[#1f2227]',
            })}
          >
            Generate Trip
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link
            href={`/trip/${tripId}`}
            className={buttonVariants({
              variant: 'outline',
              className:
                'h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]',
            })}
          >
            Return to trip room
          </Link>
          <Link
            href={`/trip/${tripId}/questionnaire`}
            className={buttonVariants({
              variant: 'outline',
              className:
                'h-11 rounded-none border-[#35383d]/40 bg-transparent px-5 hover:bg-[#e7e0cd]',
            })}
          >
            <Pencil aria-hidden="true" />
            Edit my preferences
          </Link>
        </div>
      </section>
    </AtlasShell>
  );
}
