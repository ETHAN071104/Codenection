'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Clock3,
  Clipboard,
  Compass,
  MapPinned,
  Plane,
  RefreshCw,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { SystemLoading, SystemState } from '@/components/ui/system-state';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { QuestionnaireStatusRow } from '@/lib/preferences/model';
import { formatTripDuration } from '@/lib/trips/duration';
import { getMemberDisplays } from '@/lib/trips/member-display';

type Trip = { id: string; room_code: string; duration_days: number | null };
type Member = {
  id: string;
  user_id: string;
  display_name: string;
  joined_at: string;
};

export function TripRoom({ tripId }: { tripId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [questionnaireStatus, setQuestionnaireStatus] = useState<
    QuestionnaireStatusRow[]
  >([]);
  const [hasCompletedProfile, setHasCompletedProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'access' | 'load' | null>(null);

  const loadTrip = useCallback(
    async (background = false) => {
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      setErrorKind(null);

      try {
        await ensureAnonymousUser();
        const supabase = getSupabaseBrowserClient();
        const [tripResult, membersResult, statusResult, profileResult] =
          await Promise.all([
            supabase
              .from('trips')
              .select('id, room_code, duration_days')
              .eq('id', tripId)
              .maybeSingle(),
            supabase
              .from('trip_members')
              .select('id, user_id, display_name, joined_at')
              .eq('trip_id', tripId)
              .order('joined_at', { ascending: true }),
            supabase.rpc('get_questionnaire_status', { p_trip_id: tripId }),
            supabase
              .from('preference_profiles')
              .select('completed_at')
              .eq('trip_id', tripId)
              .maybeSingle(),
          ]);

        if (tripResult.error) throw tripResult.error;
        if (!tripResult.data) {
          setError('This trip is unavailable or you are not a member.');
          setErrorKind('access');
          setTrip(null);
          setMembers([]);
          return;
        }
        if (membersResult.error) throw membersResult.error;
        if (statusResult.error) throw statusResult.error;
        if (profileResult.error) throw profileResult.error;

        setTrip(tripResult.data);
        setMembers(membersResult.data ?? []);
        setQuestionnaireStatus(statusResult.data ?? []);
        setHasCompletedProfile(Boolean(profileResult.data?.completed_at));
      } catch {
        setError(
          'We could not load this trip. Check your connection and try again.',
        );
        setErrorKind('load');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tripId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadTrip());
  }, [loadTrip]);

  async function copyRoomCode() {
    if (!trip) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(trip.room_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  const durationLabel = formatTripDuration(trip?.duration_days);
  const memberDisplays = getMemberDisplays(
    members.map((member) => ({
      id: member.id,
      userId: member.user_id,
      displayName: member.display_name,
    })),
  );
  const memberMarkerIcons = [UserRound, Plane, Compass, MapPinned];
  const completedMembers = questionnaireStatus[0]?.completed_members ?? 0;
  const totalMembers = questionnaireStatus[0]?.total_members ?? members.length;
  const allCompleted = Boolean(questionnaireStatus[0]?.all_completed);

  return (
    <main className="atlas-page min-h-[100dvh] bg-parchment text-ink">
      <header className="border-b border-warm-border bg-paper/80">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight outline-none transition-opacity hover:opacity-65 focus-visible:ring-2 focus-visible:ring-ink/30"
          >
            <Plane className="size-4 text-brown-accent" aria-hidden="true" />
            Travel Planner
          </Link>
          {trip && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-warm-muted hover:bg-parchment hover:text-ink"
              onClick={() => void loadTrip(true)}
              disabled={refreshing}
            >
              <RefreshCw
                className={refreshing ? 'animate-spin' : undefined}
                aria-hidden="true"
              />
              Refresh
            </Button>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-12 lg:py-14">
        {loading ? (
          <SystemLoading
            className="my-10"
            title="Opening your shared trip"
            description="We’re bringing in the room, members, and Travel DNA progress."
          />
        ) : error ? (
          <SystemState
            role="alert"
            eyebrow="Shared trip room"
            title={
              errorKind === 'access'
                ? 'This trip is not available in this browser.'
                : 'We could not open your trip.'
            }
            description={
              errorKind === 'access'
                ? 'Join again with the six-digit room code. Your group’s trip has not been changed.'
                : error
            }
            actions={
              <>
                {errorKind === 'load' && (
                  <Button
                    type="button"
                    className="h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90"
                    onClick={() => void loadTrip()}
                  >
                    Try again
                  </Button>
                )}
                <Link
                  href="/"
                  className={buttonVariants({
                    variant: errorKind === 'load' ? 'outline' : 'default',
                    className:
                      errorKind === 'load'
                        ? 'h-11 rounded-xl border-warm-border bg-paper px-5 text-ink hover:bg-parchment'
                        : 'h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90',
                  })}
                >
                  Return home
                </Link>
              </>
            }
          />
        ) : trip ? (
          <>
            <div className="mb-8 sm:mb-10">
              <p className="text-xs font-semibold tracking-[0.18em] text-brown-accent">
                SHARED TRIP ROOM
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div>
                  <h1 className="max-w-3xl text-balance font-editorial text-4xl leading-[0.98] font-semibold tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                    Ready when your group is.
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-warm-muted">
                    Invite your travel companions, then complete your individual
                    Travel DNA when you&apos;re ready.
                  </p>
                </div>
                <span className="w-fit rounded-full border border-warm-border bg-paper px-4 py-2 text-sm font-semibold text-warm-muted">
                  {durationLabel ? `${durationLabel} trip` : 'Shared trip'}
                </span>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-start">
              <div className="space-y-6">
                <section className="overflow-hidden rounded-2xl border border-warm-border bg-paper shadow-editorial">
                  <div className="border-b border-warm-border px-6 py-5 sm:px-8">
                    <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
                      INVITE YOUR FRIENDS
                    </p>
                    <h2 className="mt-2 font-editorial text-2xl font-semibold tracking-[-0.03em]">
                      Share this room code
                    </h2>
                  </div>
                  <div className="p-6 sm:p-8">
                    <div className="rounded-xl border border-warm-border bg-parchment px-5 py-6 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-7">
                      <div>
                        <p className="text-xs font-semibold tracking-[0.15em] text-warm-muted">
                          SIX-DIGIT CODE
                        </p>
                        <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.2em] sm:text-6xl">
                          {trip.room_code}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="mt-5 h-11 border-warm-border bg-paper px-5 text-ink hover:border-ink/30 hover:bg-paper sm:mt-0"
                        onClick={copyRoomCode}
                        aria-label="Copy room code"
                      >
                        {copied ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Clipboard aria-hidden="true" />
                        )}
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-warm-muted">
                      Friends can enter this code from the homepage. No account
                      is required.
                    </p>
                    {copied && (
                      <output
                        className="mt-2 block text-sm font-medium text-brown-accent"
                        aria-live="polite"
                      >
                        Room code copied.
                      </output>
                    )}
                    {copyError && (
                      <p
                        role="alert"
                        className="mt-3 rounded-lg border border-brown-accent/25 bg-parchment px-3 py-2 text-sm leading-6 text-ink"
                      >
                        We could not copy automatically. Select the room code
                        and copy it manually.
                      </p>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-warm-border bg-paper shadow-editorial">
                  <div className="flex items-end justify-between gap-4 border-b border-warm-border px-6 py-5 sm:px-8">
                    <div>
                      <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
                        YOUR TRAVEL CREW
                      </p>
                      <h2 className="mt-2 font-editorial text-2xl font-semibold tracking-[-0.03em]">
                        Members
                      </h2>
                    </div>
                    <span className="inline-flex items-center gap-2 text-sm text-warm-muted">
                      <UsersRound className="size-4" aria-hidden="true" />
                      {members.length}{' '}
                      {members.length === 1 ? 'traveller' : 'travellers'}
                    </span>
                  </div>
                  <ul className="divide-y divide-warm-border px-6 sm:px-8">
                    {members.map((member) => {
                      const ready = questionnaireStatus.find(
                        (row) => row.member_id === member.id,
                      )?.completed;
                      const display = memberDisplays.get(member.id);
                      const MarkerIcon =
                        memberMarkerIcons[display?.marker ?? 0];

                      return (
                        <li
                          key={member.id}
                          className="flex min-h-18 items-center gap-3 py-4"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-parchment text-brown-accent">
                            <MarkerIcon className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {display?.name ?? member.display_name}
                            {display?.tag && (
                              <span className="ml-1 text-sm font-normal text-warm-muted">
                                · {display.tag}
                              </span>
                            )}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${ready ? 'bg-ink text-paper' : 'border border-warm-border bg-parchment text-warm-muted'}`}
                          >
                            {ready ? (
                              <Check className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Clock3 className="size-3.5" aria-hidden="true" />
                            )}
                            {ready ? 'Ready' : 'Waiting'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>

              <aside className="rounded-2xl border border-warm-border bg-paper p-6 shadow-editorial sm:p-7 lg:sticky lg:top-6">
                <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
                  TRAVEL DNA
                </p>
                <h2 className="mt-2 font-editorial text-3xl font-semibold tracking-[-0.04em]">
                  Group readiness
                </h2>

                <div className="mt-6 flex items-end justify-between gap-4">
                  <p className="text-sm text-warm-muted">
                    Preferences completed
                  </p>
                  <p className="text-2xl font-semibold tracking-[-0.03em]">
                    {completedMembers} / {totalMembers}
                  </p>
                </div>
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-parchment"
                  aria-label={`${completedMembers} of ${totalMembers} travellers ready`}
                >
                  <div
                    className="h-full rounded-full bg-brown-accent transition-[width]"
                    style={{
                      width: `${totalMembers > 0 ? Math.round((completedMembers / totalMembers) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p className="mt-4 text-sm leading-6 text-warm-muted">
                  Individual answers stay private. The group result appears when
                  everyone is ready.
                </p>

                {hasCompletedProfile ? (
                  <div className="mt-6 rounded-xl border border-warm-border bg-parchment p-4">
                    <p className="flex items-center gap-2 font-semibold">
                      <span className="flex size-6 items-center justify-center rounded-full bg-ink text-paper">
                        <Check className="size-3.5" aria-hidden="true" />
                      </span>
                      Preferences saved · Ready
                    </p>
                    <p className="mt-2 text-sm leading-6 text-warm-muted">
                      Your Travel DNA is included in the group result.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 rounded-xl border border-brown-accent/30 bg-parchment p-4">
                    <p className="font-semibold">
                      Your preferences are waiting
                    </p>
                    <p className="mt-2 text-sm leading-6 text-warm-muted">
                      Add your budget, pace and interests to become ready.
                    </p>
                  </div>
                )}

                <div className="mt-6 grid gap-3">
                  {allCompleted && (
                    <Link
                      href={`/trip/${tripId}/summary`}
                      className={buttonVariants({
                        size: 'lg',
                        className:
                          'h-12 bg-ink px-5 text-paper hover:bg-ink/85',
                      })}
                    >
                      View group summary
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  )}
                  {!hasCompletedProfile && (
                    <Link
                      href={`/trip/${tripId}/questionnaire`}
                      className={buttonVariants({
                        size: 'lg',
                        className:
                          'h-12 bg-ink px-5 text-paper hover:bg-ink/85',
                      })}
                    >
                      Complete my Travel DNA
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  )}
                  {hasCompletedProfile && (
                    <Link
                      href={`/trip/${tripId}/questionnaire`}
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'lg',
                        className:
                          'h-11 border-warm-border bg-paper text-ink hover:bg-parchment',
                      })}
                    >
                      Edit my Travel DNA
                    </Link>
                  )}
                </div>

                {hasCompletedProfile && !allCompleted && (
                  <p className="mt-4 text-center text-xs leading-5 text-warm-muted">
                    You&apos;re ready. Waiting for the rest of your group.
                  </p>
                )}
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
