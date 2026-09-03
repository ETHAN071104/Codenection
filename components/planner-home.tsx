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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
    <main className="homepage-page mx-auto flex min-h-[100dvh] w-full max-w-[1400px] items-center px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
      <div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(520px,1.2fr)] lg:gap-12">
        <aside
          className="relative order-2 hidden min-h-[590px] overflow-hidden lg:order-1 lg:block"
          aria-label="Travel inspiration"
        >
          <div className="absolute left-1 top-8 z-10 max-w-[190px]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Go somewhere together
            </p>
            <p className="mt-3 font-serif text-2xl leading-tight text-foreground/85">
              A shared room for the places you’ll remember.
            </p>
          </div>
          <div className="absolute inset-x-2 bottom-8 top-28">
            <div
              aria-hidden="true"
              className="absolute left-0 top-12 h-64 w-44 rotate-[-5deg] rounded-[1.15rem] border-[5px] border-background bg-cover bg-center shadow-[0_20px_40px_-28px_rgba(27,65,60,0.7)]"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[0].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute right-8 top-1 h-44 w-64 rotate-[4deg] rounded-[1.15rem] border-[5px] border-background bg-cover bg-center shadow-[0_20px_40px_-28px_rgba(27,65,60,0.7)]"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[1].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute left-28 top-48 h-44 w-60 rotate-[2deg] rounded-[1.15rem] border-[5px] border-background bg-cover bg-center shadow-[0_20px_40px_-28px_rgba(27,65,60,0.7)]"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[2].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute bottom-2 left-2 h-44 w-60 rotate-[4deg] rounded-[1.15rem] border-[5px] border-background bg-cover bg-center shadow-[0_20px_40px_-28px_rgba(27,65,60,0.7)]"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[3].url})` }}
            />
            <div
              aria-hidden="true"
              className="absolute bottom-10 right-0 h-56 w-40 rotate-[-6deg] rounded-[1.15rem] border-[5px] border-background bg-cover bg-center shadow-[0_20px_40px_-28px_rgba(27,65,60,0.7)]"
              style={{ backgroundImage: `url(${COLLAGE_IMAGES[4].url})` }}
            />
            <div className="pointer-events-none absolute inset-y-0 right-[-1px] w-20 bg-gradient-to-l from-background via-background/45 to-transparent" />
          </div>
          <p className="absolute bottom-1 left-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Five ways to wander
          </p>
        </aside>

        <section className="order-1 flex justify-center lg:order-2">
          <div className="w-full max-w-[620px]">
            <h1 className="max-w-xl text-balance font-serif text-5xl font-semibold leading-[0.95] tracking-[-0.055em] text-foreground sm:text-6xl lg:text-7xl">
              Collaborative
              <br />
              Travel Planner
            </h1>
            <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
              One room for your crew to choose a place, share a rhythm, and
              start planning together.
            </p>

            <Card className="mt-9 border border-white/70 bg-card/95 py-0 shadow-[0_28px_80px_-36px_oklch(0.35_0.015_250/45%)] ring-0 backdrop-blur-xl">
              <CardHeader className="border-b border-border/80 px-6 py-6 sm:px-8">
                <CardTitle className="text-xl">Start planning</CardTitle>
                <CardDescription>
                  Enter the name your travel companions will see.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 py-6 sm:px-8 sm:py-8">
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
                      className="h-11 bg-background/70 px-3.5"
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
                            className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background/70 text-foreground hover:border-primary/45 hover:bg-primary/5'}`}
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
                        className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${customTripLength ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background/70 text-foreground hover:border-primary/45 hover:bg-primary/5'}`}
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
                            className="h-11 bg-background/70 px-3.5"
                          />
                        </div>
                        <p
                          id="custom-trip-days-help"
                          className="pb-3 text-sm text-muted-foreground"
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
                    className="h-12 w-full text-sm shadow-[0_12px_25px_-18px_oklch(0.3_0.015_250/80%)]"
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
                    Create Trip
                  </Button>
                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      or join friends
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="room-code" className="text-sm font-medium">
                      Room code
                    </label>
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
                      className="h-11 bg-background/70 px-3.5 font-mono text-base tracking-[0.22em]"
                      disabled={isPending}
                    />
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto rounded-none bg-transparent px-0 text-sm font-medium text-foreground hover:bg-transparent hover:text-primary"
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
                      Join Trip
                    </Button>
                  </div>
                </form>
                {!configured && (
                  <Alert className="mt-5 border-accent/60 bg-accent/20">
                    <AlertDescription>
                      Add your Supabase environment values to enable trip rooms.
                    </AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="destructive" className="mt-5">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <div
              className="mt-8 grid grid-cols-3 gap-2 lg:hidden"
              aria-label="Travel inspiration"
            >
              {COLLAGE_IMAGES.slice(0, 3).map((image, index) => (
                <div
                  key={image.label}
                  aria-hidden="true"
                  className={`h-24 rounded-xl border-4 border-background bg-cover bg-center ${index === 1 ? 'translate-y-2' : ''}`}
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
