'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Clipboard,
  Compass,
  LoaderCircle,
  MapPinned,
  Plane,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  const [error, setError] = useState<string | null>(null);

  const loadTrip = useCallback(
    async (background = false) => {
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

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
        if (membersResult.error) throw membersResult.error;
        if (statusResult.error) throw statusResult.error;
        if (profileResult.error) throw profileResult.error;
        if (!tripResult.data) {
          setError('This trip is unavailable or you are not a member.');
          setTrip(null);
          setMembers([]);
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
    try {
      await navigator.clipboard.writeText(trip.room_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
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

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-semibold tracking-tight text-primary"
        >
          <Plane className="size-5" aria-hidden="true" />
          Travel Planner
        </Link>
        {trip && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
      </header>

      {loading ? (
        <div className="flex min-h-[55vh] items-center justify-center text-muted-foreground">
          <LoaderCircle
            className="mr-2 size-5 animate-spin"
            aria-hidden="true"
          />
          Loading your trip…
        </div>
      ) : error ? (
        <Card className="mx-auto max-w-lg border border-border bg-card/90 ring-0">
          <CardHeader>
            <CardTitle>Trip unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className={buttonVariants({ className: 'w-full' })}>
              Return home
            </Link>
          </CardContent>
        </Card>
      ) : trip ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="border border-white/70 bg-card/90 py-0 shadow-[0_24px_70px_-42px_oklch(0.35_0.015_250/50%)] ring-0 backdrop-blur">
            <CardHeader className="border-b border-border px-6 py-6 sm:px-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                {durationLabel ? `${durationLabel} Trip` : 'Trip'}
              </p>
              <CardTitle className="text-2xl">Your shared room</CardTitle>
              <CardDescription>
                Share the code with your friends so they can join.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 py-6 sm:px-8">
              <p className="text-sm font-medium text-muted-foreground">
                Room Code
              </p>
              <div className="mt-2 flex items-center gap-3">
                <span className="font-mono text-3xl font-semibold tracking-[0.22em] text-foreground sm:text-4xl">
                  {trip.room_code}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyRoomCode}
                  aria-label="Copy room code"
                  title="Copy room code"
                >
                  {copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Clipboard aria-hidden="true" />
                  )}
                </Button>
              </div>
              {copied && (
                <output className="mt-2 block text-sm text-primary">
                  Room code copied.
                </output>
              )}
            </CardContent>
          </Card>

          <Card className="border border-white/70 bg-card/90 py-0 ring-0 backdrop-blur">
            <CardHeader className="border-b border-border px-5 py-5">
              <CardTitle>Members</CardTitle>
              <CardDescription>
                {members.length}{' '}
                {members.length === 1 ? 'traveler' : 'travelers'}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 py-4">
              <ul className="space-y-2">
                {members.map((member) => {
                  const ready = questionnaireStatus.find(
                    (row) => row.member_id === member.id,
                  )?.completed;
                  const display = memberDisplays.get(member.id);
                  const MarkerIcon = memberMarkerIcons[display?.marker ?? 0];

                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-3 rounded-xl bg-muted/65 px-3 py-3"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <MarkerIcon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {display?.name ?? member.display_name}
                        {display?.tag && (
                          <span className="ml-1 text-sm font-normal text-muted-foreground">
                            · {display.tag}
                          </span>
                        )}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {ready ? 'Ready' : 'Waiting'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <section className="border border-primary/20 bg-card/75 p-6 md:col-span-2 sm:p-8">
            <div className="grid items-end gap-6 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="text-sm font-semibold text-primary">Travel DNA</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                  Plan around the whole group.
                </h2>
                <p className="mt-3 max-w-xl leading-7 text-muted-foreground">
                  {questionnaireStatus[0]?.completed_members ?? 0} /{' '}
                  {questionnaireStatus[0]?.total_members ?? members.length}{' '}
                  completed. Individual answers stay private.
                </p>
              </div>
              <Link
                href={`/trip/${tripId}/questionnaire`}
                className={buttonVariants({
                  size: 'lg',
                  className: 'h-11 px-5',
                })}
              >
                {hasCompletedProfile
                  ? 'Edit my preferences'
                  : 'Complete my Travel DNA'}
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>

            {questionnaireStatus[0]?.all_completed && (
              <div className="mt-6 border-t border-border pt-5">
                <Link
                  href={`/trip/${tripId}/summary`}
                  className={buttonVariants({
                    variant: 'outline',
                    className: 'bg-background/60',
                  })}
                >
                  View group summary
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
