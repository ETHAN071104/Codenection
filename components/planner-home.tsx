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
import {
  ArrowRight,
  LoaderCircle,
  MapPin,
  Plane,
  UsersRound,
} from 'lucide-react';
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

const COLLAGE_IMAGES = [
  {
    label: 'European city street',
    url: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=700&q=82',
  },
  {
    label: 'Tropical coast',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=700&q=82',
  },
  {
    label: 'Mountain landscape',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=700&q=82',
  },
  {
    label: 'Cultural landmark',
    url: 'https://images.unsplash.com/photo-1548013146-72479768bada?auto=format&fit=crop&w=700&q=82',
  },
  {
    label: 'Coastal town',
    url: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=700&q=82',
  },
];

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
      router.push(`/trip/${trip.trip_id}`);
    } catch (actionError) {
      setError(getFriendlyTripError(actionError));
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;
  const selectedCustomDays = parseTripDuration(customTripDays);

  return (
    <main className="homepage-page min-h-[100dvh] bg-parchment text-ink">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-[1400px] items-center gap-10 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,0.86fr)_minmax(520px,1.14fr)] lg:gap-16 lg:px-12 lg:py-14">
        <aside
          className="relative hidden min-h-[680px] overflow-hidden lg:block"
          aria-label="Travel inspiration"
        >
          <div className="relative z-10 max-w-md pt-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brown-accent">
              Travel is better together
            </p>
            <h2 className="mt-4 text-balance font-editorial text-5xl leading-[0.98] font-semibold tracking-[-0.045em]">
              A shared room for the places you&apos;ll remember.
            </h2>
          </div>
          <div className="absolute inset-x-0 bottom-10 top-44">
            <div
              aria-hidden="true"
              className="absolute left-0 top-14 h-64 w-44 rotate-[-5deg] rounded-2xl border-[5px] border-parchment bg-cover bg-center shadow-editorial"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[0].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute right-7 top-0 h-48 w-64 rotate-[4deg] rounded-2xl border-[5px] border-parchment bg-cover bg-center shadow-editorial"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[1].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute left-28 top-52 h-44 w-60 rotate-[2deg] rounded-2xl border-[5px] border-parchment bg-cover bg-center shadow-editorial"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[2].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute bottom-1 left-2 h-44 w-60 rotate-[4deg] rounded-2xl border-[5px] border-parchment bg-cover bg-center shadow-editorial"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[3].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute right-0 bottom-8 h-56 w-40 rotate-[-6deg] rounded-2xl border-[5px] border-parchment bg-cover bg-center shadow-editorial"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[4].url})` }}
            />
          </div>
          <p className="absolute bottom-0 left-1 text-xs uppercase tracking-[0.18em] text-warm-muted">
            Five ways to wander
          </p>
        </aside>

        <section className="flex justify-center">
          <div className="w-full max-w-[650px]">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-brown-accent">
              <Plane className="size-4" aria-hidden="true" />
              COLLABORATIVE TRAVEL PLANNER
            </div>
            <h1 className="mt-5 max-w-xl text-balance font-editorial text-5xl leading-[0.94] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Plan your trip together.
            </h1>
            <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-warm-muted sm:text-lg">
              One room for your crew to share a rhythm, choose the places that
              matter, and build the day together.
            </p>

            <div className="mt-8 overflow-hidden rounded-2xl border border-warm-border bg-paper shadow-editorial sm:mt-10">
              <div className="border-b border-warm-border px-6 py-5 sm:px-8 sm:py-6">
                <p className="text-xs font-semibold tracking-[0.16em] text-brown-accent">
                  CREATE A TRIP
                </p>
                <h2 className="mt-2 font-editorial text-2xl font-semibold tracking-[-0.03em]">
                  Start with your travel crew
                </h2>
                <p className="mt-1 text-sm text-warm-muted">
                  Enter the name your travel companions will see.
                </p>
              </div>
              <div className="px-6 py-6 sm:px-8 sm:py-8">
                <form onSubmit={createTrip} className="space-y-6">
                  <div className="space-y-2">
                    <label
                      htmlFor="display-name"
                      className="text-sm font-medium"
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
                      className="h-12 border-warm-border bg-parchment/50 px-4 focus-visible:border-ink focus-visible:ring-ink/15"
                      disabled={isPending}
                    />
                  </div>
                  <fieldset className="space-y-3" disabled={isPending}>
                    <legend className="text-sm font-medium">Trip length</legend>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {TRIP_LENGTH_PRESETS.map((days) => {
                        const selected = !customTripLength && tripDays === days;
                        return (
                          <button
                            key={days}
                            type="button"
                            aria-pressed={selected}
                            className={`min-h-11 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 disabled:opacity-50 ${selected ? 'border-ink bg-ink text-paper' : 'border-warm-border bg-parchment/50 text-ink hover:border-brown-accent/55 hover:bg-parchment'}`}
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
                        className={`min-h-11 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 disabled:opacity-50 ${customTripLength ? 'border-ink bg-ink text-paper' : 'border-warm-border bg-parchment/50 text-ink hover:border-brown-accent/55 hover:bg-parchment'}`}
                        onClick={() => {
                          setCustomTripLength(true);
                          setError(null);
                        }}
                      >
                        Custom
                      </button>
                    </div>
                    {customTripLength && (
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <div className="space-y-2">
                          <label
                            htmlFor="custom-trip-days"
                            className="text-sm font-medium"
                          >
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
                            placeholder="7"
                            value={customTripDays}
                            onChange={(event) => {
                              setCustomTripDays(event.target.value);
                              setError(null);
                            }}
                            aria-invalid={selectedCustomDays === null}
                            aria-describedby="custom-trip-days-help"
                            className="h-12 border-warm-border bg-parchment/50 px-4 focus-visible:border-ink focus-visible:ring-ink/15"
                          />
                        </div>
                        <p
                          id="custom-trip-days-help"
                          className="pb-3 text-sm text-warm-muted"
                        >
                          {selectedCustomDays === null
                            ? `Enter 1-${MAX_TRIP_DAYS} days.`
                            : `${formatTripDuration(selectedCustomDays)} Trip`}
                        </p>
                      </div>
                    )}
                  </fieldset>
                  <Button
                    type="submit"
                    size="lg"
                    className="h-12 w-full bg-ink text-sm text-paper shadow-[0_16px_30px_-22px_rgb(36_32_28/80%)] hover:bg-ink/85"
                    disabled={
                      isPending ||
                      !configured ||
                      (customTripLength && selectedCustomDays === null)
                    }
                  >
                    {pendingAction === 'create' ? (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Plane aria-hidden="true" />
                    )}
                    {pendingAction === 'create'
                      ? 'Creating trip…'
                      : 'Create Trip'}
                  </Button>
                  <div
                    id="join-trip"
                    className="scroll-mt-6 border-t border-warm-border pt-6"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-parchment text-brown-accent">
                        <UsersRound className="size-4" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 className="font-editorial text-xl font-semibold tracking-[-0.025em]">
                          Join an existing trip
                        </h3>
                        <p className="mt-1 text-sm text-warm-muted">
                          Use the six-digit code shared by a friend.
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="space-y-2">
                        <label
                          htmlFor="room-code"
                          className="text-sm font-medium"
                        >
                          Room code
                        </label>
                        <div className="relative">
                          <MapPin
                            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-warm-muted"
                            aria-hidden="true"
                          />
                          <Input
                            id="room-code"
                            name="roomCode"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            pattern="[0-9]{6}"
                            placeholder="381527"
                            value={roomCode}
                            onChange={(event) =>
                              setRoomCode(normalizeRoomCode(event.target.value))
                            }
                            className="h-12 border-warm-border bg-parchment/50 pl-11 font-mono text-base tracking-[0.22em] focus-visible:border-ink focus-visible:ring-ink/15"
                            disabled={isPending}
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="h-12 self-end border-warm-border bg-paper px-5 text-ink hover:border-ink/35 hover:bg-parchment"
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
                        {pendingAction === 'join'
                          ? 'Joining trip…'
                          : 'Join Trip'}
                      </Button>
                    </div>
                  </div>
                </form>
                {!configured && (
                  <SystemNotice
                    className="mt-5 bg-parchment"
                    title="Trip rooms are unavailable right now."
                    description="Nothing has been submitted. Your form entries are still here, so try again after the connection is restored."
                  />
                )}
                {error && (
                  <SystemNotice
                    role="alert"
                    className="mt-5 border-brown-accent/30 bg-paper text-ink"
                    title="We couldn’t continue with that trip."
                    description={`${error} Your form entries are still here, so you can correct them or try again.`}
                  />
                )}
              </div>
            </div>

            <div
              className="mt-8 grid grid-cols-3 gap-2 lg:hidden"
              aria-label="Travel inspiration"
            >
              {COLLAGE_IMAGES.slice(0, 3).map((image, index) => (
                <div
                  key={image.label}
                  aria-hidden="true"
                  className={`h-24 rounded-xl border-4 border-parchment bg-cover bg-center shadow-editorial ${index === 1 ? 'translate-y-2' : ''}`}
                  style={{ backgroundImage: `url(${image.url})` }}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
