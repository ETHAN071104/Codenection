'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  Clock3,
  Clipboard,
  Compass,
  MapPinned,
  Plane,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  SystemLoading,
  SystemNotice,
  SystemState,
} from '@/components/ui/system-state';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { QuestionnaireStatusRow } from '@/lib/preferences/model';
import { formatTripDuration } from '@/lib/trips/duration';
import { getMemberDisplays } from '@/lib/trips/member-display';

type Trip = {
  id: string;
  room_code: string;
  duration_days: number | null;
  finalized_at: string | null;
  setup_stage: string;
};
type Member = {
  id: string;
  user_id: string;
  display_name: string;
  joined_at: string;
};

export function TripRoom({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [questionnaireStatus, setQuestionnaireStatus] = useState<
    QuestionnaireStatusRow[]
  >([]);
  const [hasCompletedProfile, setHasCompletedProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'access' | 'load' | null>(null);
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const loadTrip = useCallback(
    async (background = false) => {
      if (!background) setLoading(true);
      setError(null);
      setErrorKind(null);

      try {
        await ensureAnonymousUser();
        const supabase = getSupabaseBrowserClient();
        const [tripResult, membersResult, statusResult, profileResult] =
          await Promise.all([
            supabase
              .from('trips')
              .select('id, room_code, duration_days, finalized_at, setup_stage')
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

        if (tripResult.data.finalized_at) {
          router.replace(`/trip/${tripId}/plan`);
          return;
        }
        if (tripResult.data.setup_stage === 'places') {
          router.replace(`/trip/${tripId}/places`);
          return;
        }
        if (tripResult.data.setup_stage === 'ai_ready') {
          router.replace(`/trip/${tripId}/itinerary?step=result`);
          return;
        }

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
      }
    },
    [router, tripId],
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadTrip());
  }, [loadTrip]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const scheduleReload = () => {
      if (realtimeRefreshTimer.current) {
        clearTimeout(realtimeRefreshTimer.current);
      }
      realtimeRefreshTimer.current = setTimeout(() => {
        void loadTrip(true);
      }, 180);
    };
    const channel = supabase
      .channel(`trip-room-lifecycle:${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `id=eq.${tripId}`,
        },
        (payload) => {
          const next = payload.new as {
            finalized_at?: string | null;
            setup_stage?: string;
          };
          if (next.finalized_at) {
            router.replace(`/trip/${tripId}/plan`);
          } else if (next.setup_stage === 'places') {
            router.replace(`/trip/${tripId}/places`);
          } else if (next.setup_stage === 'ai_ready') {
            router.replace(`/trip/${tripId}/itinerary?step=result`);
          } else {
            scheduleReload();
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trip_members',
          filter: `trip_id=eq.${tripId}`,
        },
        scheduleReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'preference_profiles',
          filter: `trip_id=eq.${tripId}`,
        },
        scheduleReload,
      )
      .subscribe();
    return () => {
      if (realtimeRefreshTimer.current) {
        clearTimeout(realtimeRefreshTimer.current);
        realtimeRefreshTimer.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [loadTrip, router, tripId]);

  useEffect(() => {
    const refreshVisibleRoom = () => {
      if (document.visibilityState === 'visible') void loadTrip(true);
    };
    const fallbackRefresh = window.setInterval(refreshVisibleRoom, 5000);
    window.addEventListener('focus', refreshVisibleRoom);
    document.addEventListener('visibilitychange', refreshVisibleRoom);
    return () => {
      window.clearInterval(fallbackRefresh);
      window.removeEventListener('focus', refreshVisibleRoom);
      document.removeEventListener('visibilitychange', refreshVisibleRoom);
    };
  }, [loadTrip]);

  useEffect(() => {
    const refreshVisibleRoom = () => {
      if (document.visibilityState === 'visible') void loadTrip(true);
    };
    const pollTimer = window.setInterval(refreshVisibleRoom, 5000);
    window.addEventListener('focus', refreshVisibleRoom);
    return () => {
      window.clearInterval(pollTimer);
      window.removeEventListener('focus', refreshVisibleRoom);
    };
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
    <main className="atlas-page relative isolate min-h-[100dvh] overflow-hidden bg-[#1b211f] text-white">
      <video
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        disablePictureInPicture
        aria-hidden="true"
      >
        <source src="/videos/welcome_page.mp4" type="video/mp4" />
      </video>
      <div aria-hidden="true" className="absolute inset-0 bg-black/38" />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,12,.64)_0%,rgba(7,12,12,.18)_34%,rgba(7,12,12,.5)_100%)]"
      />

      <div className="relative z-10 mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-8 sm:py-10 lg:py-12">
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
                  href={errorKind === 'access' ? '/#join-trip' : '/'}
                  className={buttonVariants({
                    variant: errorKind === 'load' ? 'outline' : 'default',
                    className:
                      errorKind === 'load'
                        ? 'h-11 rounded-xl border-warm-border bg-paper px-5 text-ink hover:bg-parchment'
                        : 'h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90',
                  })}
                >
                  {errorKind === 'access' ? 'Join trip' : 'Return home'}
                </Link>
                {errorKind === 'access' && (
                  <Link
                    href="/"
                    className={buttonVariants({
                      variant: 'ghost',
                      className:
                        'h-11 rounded-xl px-5 text-warm-muted hover:bg-parchment hover:text-ink',
                    })}
                  >
                    Return home
                  </Link>
                )}
              </>
            }
          />
        ) : trip?.finalized_at ? (
          <section className="mx-auto w-full max-w-3xl rounded-2xl border border-white/45 bg-[#fffaf0]/92 p-6 text-ink shadow-editorial backdrop-blur-xl sm:p-10 lg:p-12">
            <span className="flex size-12 items-center justify-center rounded-full bg-ink text-paper">
              <MapPinned className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-7 text-xs font-semibold tracking-[0.16em] text-brown-accent">
              TRIP ALREADY PLANNED
            </p>
            <h1 className="mt-3 font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
              Join the trip and travel together.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-warm-muted">
              The original planning round is closed. The saved itinerary, map,
              Live Trip and group updates are ready for all {members.length}{' '}
              {members.length === 1 ? 'traveller' : 'travellers'}.
            </p>
            <div className="mt-8 rounded-xl border border-warm-border bg-parchment p-5">
              <p className="text-xs font-semibold tracking-[0.15em] text-warm-muted">
                ROOM CODE
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
                <p className="font-mono text-3xl font-semibold tracking-[0.18em]">
                  {trip.room_code}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyRoomCode}
                  className="h-10 border-warm-border bg-paper"
                >
                  {copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Clipboard aria-hidden="true" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/trip/${tripId}/plan`}
                className={buttonVariants({
                  size: 'lg',
                  className: 'h-12 bg-ink px-6 text-paper hover:bg-ink/85',
                })}
              >
                View trip
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link
                href={`/trip/${tripId}/live`}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'lg',
                  className:
                    'h-12 border-warm-border bg-paper px-6 text-ink hover:bg-parchment',
                })}
              >
                Open Live Trip
              </Link>
            </div>
          </section>
        ) : trip ? (
          <>
            <div className="mb-7">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div>
                  <h1 className="max-w-4xl text-balance font-editorial text-5xl leading-[0.94] font-semibold tracking-[-0.05em] text-white sm:text-6xl">
                    Ready when your group is.
                  </h1>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-white/76 sm:text-lg">
                    Invite your travel companions, then complete your individual
                    travel profile when you&apos;re ready.
                  </p>
                </div>
                <span className="mb-1 w-fit rounded-full border border-white/55 bg-[#fffaf0]/94 px-6 py-3 text-base font-semibold text-ink shadow-sm backdrop-blur-md">
                  {durationLabel ? `${durationLabel} trip` : 'Shared trip'}
                </span>
              </div>
            </div>

            <div className="grid items-stretch gap-5 lg:grid-cols-[1.06fr_.94fr]">
              <section className="overflow-hidden rounded-[1.6rem] border border-white/55 bg-[#fffaf0]/94 p-6 text-ink shadow-[0_28px_70px_-38px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-8">
                <p className="text-xs font-semibold tracking-[0.18em] text-brown-accent">
                  INVITE YOUR FRIENDS
                </p>
                <h2 className="mt-2 font-editorial text-3xl font-semibold tracking-[-0.035em]">
                  Share this room code
                </h2>
                <p className="mt-2 text-sm leading-6 text-warm-muted">
                  Friends can enter this code from the homepage. No account is
                  required.
                </p>

                <div className="mt-5 rounded-2xl border border-warm-border bg-white/42 px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-7">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.15em] text-warm-muted">
                      SIX-DIGIT CODE
                    </p>
                    <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.2em] sm:text-5xl">
                      {trip.room_code}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="mt-5 h-12 rounded-xl border-warm-border bg-white/55 px-5 text-ink hover:border-ink/30 hover:bg-white sm:mt-0"
                    onClick={copyRoomCode}
                    aria-label="Copy room code"
                  >
                    {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {copied && (
                  <output className="mt-2 block text-sm font-medium text-brown-accent" aria-live="polite">
                    Room code copied.
                  </output>
                )}
                {copyError && (
                  <SystemNotice
                    role="alert"
                    className="mt-3 bg-parchment px-3 py-2.5"
                    title="The room code wasn’t copied."
                    description="Your trip is unchanged. Select the code above and copy it manually."
                  />
                )}

                <div className="mt-6 border-t border-warm-border pt-5">
                  <div className="flex items-end justify-between gap-4">
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
                      {members.length} {members.length === 1 ? 'traveller' : 'travellers'}
                    </span>
                  </div>
                  <ul className="mt-3 max-h-40 divide-y divide-warm-border overflow-y-auto">
                    {members.map((member) => {
                      const ready = questionnaireStatus.find((row) => row.member_id === member.id)?.completed;
                      const display = memberDisplays.get(member.id);
                      const MarkerIcon = memberMarkerIcons[display?.marker ?? 0];
                      return (
                        <li key={member.id} className="flex min-h-14 items-center gap-3 py-2.5">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-parchment text-brown-accent">
                            <MarkerIcon className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {display?.name ?? member.display_name}
                            {display?.tag && <span className="ml-1 text-sm font-normal text-warm-muted">· {display.tag}</span>}
                          </span>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${ready ? 'bg-ink text-paper' : 'border border-warm-border bg-parchment text-warm-muted'}`}>
                            {ready ? <Check className="size-3.5" aria-hidden="true" /> : <Clock3 className="size-3.5" aria-hidden="true" />}
                            {ready ? 'Ready' : 'Waiting'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>

              <aside className="h-full rounded-[1.6rem] border border-white/55 bg-[#fffaf0]/94 p-6 text-ink shadow-[0_28px_70px_-38px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-8">
                <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
                  GET TO KNOW YOUR GROUP
                </p>
                <h2 className="mt-2 font-editorial text-4xl font-semibold tracking-[-0.045em]">
                  Group readiness
                </h2>

                <div className="mt-12 flex items-end justify-between gap-4">
                  <p className="text-base text-warm-muted">
                    Preferences completed
                  </p>
                  <p className="text-3xl font-semibold tracking-[-0.04em]">
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
                {hasCompletedProfile ? (
                  <div className="mt-10 rounded-2xl border border-warm-border bg-white/36 p-5">
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
                  <div className="mt-10 rounded-2xl border border-warm-border bg-white/36 p-5">
                    <p className="font-semibold">
                      Your preferences are waiting
                    </p>
                    <p className="mt-2 text-sm leading-6 text-warm-muted">
                      Add your budget, pace and interests to become ready.
                    </p>
                  </div>
                )}

                <div className="mt-8 grid gap-3">
                  {allCompleted && (
                    <Link
                      href={`/trip/${tripId}/summary`}
                      className={buttonVariants({
                        size: 'lg',
                        className:
                          'h-12 rounded-xl bg-ink px-5 text-paper hover:bg-ink/85',
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
                          'h-12 rounded-xl bg-ink px-5 text-paper hover:bg-ink/85',
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
