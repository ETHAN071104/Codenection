'use client';

import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { ArrowRight, LoaderCircle, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SystemNotice } from '@/components/ui/system-state';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from '@/lib/supabase/client';
import { getFriendlyTripError } from '@/lib/trips/errors';
import {
  DEFAULT_TRIP_DAYS,
  MAX_TRIP_DAYS,
  formatTripDuration,
  parseTripDuration,
} from '@/lib/trips/duration';
import {
  normalizeDisplayName,
  normalizeRoomCode,
  validateDisplayName,
  validateRoomCode,
} from '@/lib/trips/validation';

type Action = 'create' | 'join';
const TRIP_LENGTH_PRESETS = [1, 2, 3, 4, 5] as const;

export function PlannerHome() {
  const router = useRouter();
  const identityPromise = useRef<Promise<User> | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [tripDays, setTripDays] = useState(DEFAULT_TRIP_DAYS);
  const [customTripLength, setCustomTripLength] = useState(false);
  const [customTripDays, setCustomTripDays] = useState('');
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  const ensureIdentity = useCallback(() => {
    identityPromise.current ??= ensureAnonymousUser().catch((identityError) => {
      identityPromise.current = null;
      throw identityError;
    });
    return identityPromise.current;
  }, []);

  useEffect(() => {
    if (configured) void ensureIdentity().catch(() => undefined);
  }, [configured, ensureIdentity]);

  async function createTrip(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const nameError = validateDisplayName(displayName);
    if (nameError) return setError(nameError);
    const durationDays = customTripLength
      ? parseTripDuration(customTripDays)
      : tripDays;
    if (durationDays === null)
      return setError(`Enter a whole number from 1 to ${MAX_TRIP_DAYS} days.`);
    setPendingAction('create');
    try {
      await ensureIdentity();
      const { data, error: rpcError } = await getSupabaseBrowserClient().rpc(
        'create_trip',
        {
          p_display_name: normalizeDisplayName(displayName),
          p_duration_days: durationDays,
        },
      );
      if (rpcError) throw rpcError;
      const trip = data?.[0];
      if (!trip) throw new Error('TRIP_CREATION_FAILED');
      router.push(`/trip/${trip.trip_id}`);
    } catch (actionError) {
      setError(getFriendlyTripError(actionError));
      setPendingAction(null);
    }
  }

  async function joinTrip() {
    setError(null);
    const nameError = validateDisplayName(displayName);
    const codeError = validateRoomCode(roomCode);
    if (nameError || codeError) return setError(nameError ?? codeError);
    setPendingAction('join');
    try {
      await ensureIdentity();
      const { data, error: rpcError } = await getSupabaseBrowserClient().rpc(
        'join_trip_by_code',
        {
          p_display_name: normalizeDisplayName(displayName),
          p_room_code: roomCode,
        },
      );
      if (rpcError) throw rpcError;
      const trip = data?.[0];
      if (!trip) throw new Error('ROOM_NOT_FOUND');
      const { data: lifecycle, error: lifecycleError } =
        await getSupabaseBrowserClient()
          .from('trips')
          .select('finalized_at')
          .eq('id', trip.trip_id)
          .maybeSingle();
      if (lifecycleError) throw lifecycleError;
      router.push(
        lifecycle?.finalized_at
          ? `/trip/${trip.trip_id}/plan`
          : `/trip/${trip.trip_id}`,
      );
    } catch (actionError) {
      setError(getFriendlyTripError(actionError));
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;
  const selectedCustomDays = parseTripDuration(customTripDays);

  return (
    <main className="homepage-page relative isolate min-h-[100dvh] overflow-x-hidden bg-[#1b211f] text-white lg:h-[100dvh] lg:overflow-hidden">
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
      <div aria-hidden="true" className="absolute inset-0 bg-black/28" />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,12,.56)_0%,rgba(7,12,12,.06)_38%,rgba(7,12,12,.42)_100%)]"
      />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1500px] flex-col px-5 sm:px-8 lg:h-[100dvh] lg:px-12 xl:px-16">
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-white/25 py-3 text-xs font-semibold tracking-[0.16em] text-white/85">
          <div className="flex items-center gap-2">
            <Plane className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              COLLABORATIVE TRAVEL PLANNER
            </span>
            <span className="sm:hidden">TRAVEL PLANNER</span>
          </div>
          <a
            href="#join-trip"
            className="transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
          >
            JOIN A TRIP
          </a>
        </header>

        <section className="flex flex-1 flex-col items-center justify-start py-[clamp(1rem,2.8vh,2rem)] text-center lg:min-h-0">
          <div className="shrink-0">
            <p className="text-[0.68rem] font-semibold tracking-[0.24em] text-white/72 sm:text-xs">
              PLAN LESS. BE THERE MORE.
            </p>
            <h1 className="mt-[clamp(.4rem,1vh,.8rem)] text-balance font-editorial text-[clamp(3rem,7vh,5.3rem)] leading-[0.9] font-medium tracking-[-0.06em] text-white [text-shadow:0_2px_26px_rgba(0,0,0,.32)]">
              Plan your trip
              <br />
              together.
            </h1>
            <p className="mx-auto mt-[clamp(.55rem,1.4vh,1rem)] max-w-xl text-sm leading-6 text-white/78 sm:text-base">
              Create one room, choose together, and shape a trip everyone wants
              to take.
            </p>
          </div>

          <div className="mt-[clamp(.8rem,2.2vh,1.5rem)] w-full max-w-[820px] shrink-0 rounded-[1.35rem] border border-white/20 bg-[rgba(11,22,27,.68)] p-[clamp(1rem,2vh,1.5rem)] text-left text-white shadow-[0_28px_80px_-30px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,255,255,.08)] backdrop-blur-[18px] backdrop-saturate-125">
            <div className="border-b border-white/15 pb-3">
              <p className="text-[0.66rem] font-semibold tracking-[0.18em] text-[#e2b98f]">
                CREATE A TRIP
              </p>
              <h2 className="mt-1 font-editorial text-2xl font-semibold tracking-[-0.035em] text-[#fffaf0] sm:text-3xl">
                Start with your travel crew
              </h2>
              <p className="mt-1 text-xs leading-5 text-white/58">
                Enter the name your travel companions will see.
              </p>
            </div>

            <form onSubmit={createTrip} className="mt-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="display-name"
                  className="text-xs font-medium text-white/72"
                >
                  Name
                </label>
                <Input
                  id="display-name"
                  name="displayName"
                  autoComplete="name"
                  maxLength={80}
                  placeholder="Ethan"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="h-11 rounded-xl border-white/16 bg-white/10 px-3 text-white placeholder:text-white/38 focus-visible:border-white/45 focus-visible:ring-white/15"
                  disabled={isPending}
                />
              </div>

              <fieldset className="mt-4 space-y-1.5" disabled={isPending}>
                <legend className="text-xs font-medium text-white/72">
                  Trip length
                </legend>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {TRIP_LENGTH_PRESETS.map((days) => {
                    const selected = !customTripLength && tripDays === days;
                    return (
                      <button
                        key={days}
                        type="button"
                        aria-pressed={selected}
                        className={`h-10 rounded-xl border px-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/65 disabled:opacity-50 ${selected ? 'border-[#f2e7d5] bg-[#f2e7d5] text-[#202522] shadow-sm' : 'border-white/12 bg-white/9 text-white/72 hover:border-white/28 hover:bg-white/14 hover:text-white'}`}
                        onClick={() => {
                          setTripDays(days);
                          setCustomTripLength(false);
                          setError(null);
                        }}
                      >
                        {formatTripDuration(days)}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-pressed={customTripLength}
                    className={`h-10 rounded-xl border px-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/65 disabled:opacity-50 ${customTripLength ? 'border-[#f2e7d5] bg-[#f2e7d5] text-[#202522] shadow-sm' : 'border-white/12 bg-white/9 text-white/72 hover:border-white/28 hover:bg-white/14 hover:text-white'}`}
                    onClick={() => {
                      setCustomTripLength(true);
                      setError(null);
                    }}
                  >
                    Custom
                  </button>
                </div>
              </fieldset>

              {customTripLength && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[13rem_1fr] sm:items-center">
                  <label htmlFor="custom-trip-days" className="sr-only">
                    Number of days
                  </label>
                  <Input
                    id="custom-trip-days"
                    name="durationDays"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_TRIP_DAYS}
                    step={1}
                    placeholder="Number of days"
                    value={customTripDays}
                    onChange={(event) => {
                      setCustomTripDays(event.target.value);
                      setError(null);
                    }}
                    aria-invalid={selectedCustomDays === null}
                    aria-describedby="custom-trip-days-help"
                    className="h-10 rounded-xl border-white/16 bg-white/10 px-3 text-white placeholder:text-white/38 focus-visible:border-white/45 focus-visible:ring-white/15"
                  />
                  <p
                    id="custom-trip-days-help"
                    className="text-xs text-white/55"
                  >
                    {selectedCustomDays === null
                      ? `Enter a whole number from 1-${MAX_TRIP_DAYS} days.`
                      : `${formatTripDuration(selectedCustomDays)} trip`}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="mt-4 h-11 w-full rounded-xl bg-[#f2e7d5] text-sm text-[#252823] shadow-[0_12px_28px_-18px_rgba(0,0,0,.75)] hover:bg-[#fff8e9]"
                disabled={
                  isPending ||
                  !configured ||
                  (customTripLength && selectedCustomDays === null)
                }
              >
                {pendingAction === 'create' ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Plane aria-hidden="true" />
                )}
                {pendingAction === 'create' ? 'Creating trip…' : 'Create Trip'}
              </Button>

              <div
                id="join-trip"
                className="mt-4 scroll-mt-4 border-t border-white/15 pt-4"
              >
                <div>
                  <p className="text-[0.62rem] font-semibold tracking-[0.16em] text-[#e2b98f]">
                    OR JOIN FRIENDS
                  </p>
                  <h3 className="mt-1 font-editorial text-xl font-semibold tracking-[-0.025em] text-[#fffaf0]">
                    Join an existing trip
                  </h3>
                  <p className="text-xs text-white/55">
                    Use the six-digit code shared by a friend.
                  </p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <label htmlFor="room-code" className="sr-only">
                      Room code
                    </label>
                    <Input
                      id="room-code"
                      name="roomCode"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      placeholder="Room code"
                      value={roomCode}
                      onChange={(event) =>
                        setRoomCode(normalizeRoomCode(event.target.value))
                      }
                      className="h-11 rounded-xl border-white/16 bg-white/10 px-3 font-mono text-sm tracking-[0.18em] text-white placeholder:text-white/38 focus-visible:border-white/45 focus-visible:ring-white/15"
                      disabled={isPending}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-11 rounded-xl border-white/22 bg-white/7 px-6 text-white hover:border-white/40 hover:bg-white/12"
                    onClick={joinTrip}
                    disabled={isPending || !configured}
                  >
                    {pendingAction === 'join' ? (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight aria-hidden="true" />
                    )}
                    {pendingAction === 'join' ? 'Joining trip…' : 'Join Trip'}
                  </Button>
                </div>
              </div>
            </form>

            {!configured && (
              <SystemNotice
                className="mt-3 border-white/16 bg-black/25 py-3 text-white"
                title="Trip rooms are unavailable right now."
                description="Nothing has been submitted. Your form entries are still here, so try again after the connection is restored."
              />
            )}
            {error && (
              <SystemNotice
                role="alert"
                className="mt-3 border-[#e2b98f]/40 bg-black/30 py-3 text-white"
                title="We couldn’t continue with that trip."
                description={`${error} Your form entries are still here, so you can correct them or try again.`}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
