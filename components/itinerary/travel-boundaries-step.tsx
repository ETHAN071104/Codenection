'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  LoaderCircle,
  MapPin,
  PlaneLanding,
  PlaneTakeoff,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SystemNotice } from '@/components/ui/system-state';
import { phase2Fetch } from '@/lib/phase2/client';
import type { PlaceCandidate } from '@/lib/phase2/types';
import type { TripEndpoint } from '@/lib/trips/travel-boundaries';

type PointMode = 'keep' | 'skip' | 'place';
type DepartureMode = PointMode | 'same';

function endpointMode(endpoint: TripEndpoint | null): PointMode {
  return endpoint ? 'keep' : 'skip';
}

function PointSearch({
  tripId,
  label,
  selected,
  onSelect,
}: {
  tripId: string;
  label: string;
  selected: TripEndpoint | null;
  onSelect: (place: PlaceCandidate) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: { preventDefault(): void }) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const payload = await phase2Fetch<{ results: PlaceCandidate[] }>(
        `/api/trips/${tripId}/travel-boundaries/search`,
        { method: 'POST', body: JSON.stringify({ query: query.trim() }) },
      );
      setResults(payload.results);
      if (!payload.results.length) {
        setError('No grounded airport or transport point matched that search.');
      }
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : 'Endpoint search is unavailable.',
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-warm-border/80 bg-white/45 p-4">
      {selected && (
        <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-ink">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brown-accent" aria-hidden="true" />
          <span>
            {selected.name}
            {selected.address && (
              <span className="mt-1 block text-xs font-normal leading-5 text-warm-muted">
                {selected.address}
              </span>
            )}
          </span>
        </p>
      )}
      <form onSubmit={search}>
        <label className="text-xs font-semibold text-warm-muted">{label}</label>
        <div className="mt-2 flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search airport or station"
            className="h-11 rounded-xl border-warm-border bg-white/65"
          />
          <Button
            type="submit"
            disabled={searching || query.trim().length < 2}
            className="h-11 rounded-xl bg-ink px-4 text-paper"
          >
            {searching ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span className="sr-only">Search</span>
          </Button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs leading-5 text-warm-muted">{error}</p>}
      {results.length > 0 && (
        <div className="mt-3 divide-y divide-warm-border border-t border-warm-border">
          {results.map((place) => (
            <button
              key={place.externalPlaceId}
              type="button"
              onClick={() => onSelect(place)}
              className="flex w-full items-start justify-between gap-3 py-3 text-left"
            >
              <span>
                <span className="block text-sm font-semibold text-ink">{place.name}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-warm-muted">
                  {place.address ?? 'Address unavailable'}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-brown-accent">Choose</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BookingField({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-warm-border/80 bg-white/62 px-4 shadow-[0_7px_22px_rgb(63_48_33/5%)]">
      <span className="shrink-0 text-ink">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-warm-muted">{label}</span>
        {children}
      </span>
    </div>
  );
}

export function TravelBoundariesStep({
  tripId,
  destination,
  startDate,
  endDate,
  initialArrivalTime,
  initialDepartureTime,
  initialArrivalPoint,
  initialDeparturePoint,
  onSaved,
  onBack,
}: {
  tripId: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  initialArrivalTime: string | null;
  initialDepartureTime: string | null;
  initialArrivalPoint: TripEndpoint | null;
  initialDeparturePoint: TripEndpoint | null;
  onSaved: (value: {
    startDate: string | null;
    endDate: string | null;
    arrivalTime: string | null;
    departureTime: string | null;
    arrivalPoint: TripEndpoint | null;
    departurePoint: TripEndpoint | null;
  }) => void;
  onBack: () => void;
}) {
  const [arrivalDate, setArrivalDate] = useState(startDate ?? '');
  const [departureDate, setDepartureDate] = useState(endDate ?? '');
  const [arrivalTime, setArrivalTime] = useState(initialArrivalTime ?? '');
  const [departureTime, setDepartureTime] = useState(initialDepartureTime ?? '');
  const [arrivalPoint, setArrivalPoint] = useState(initialArrivalPoint);
  const [departurePoint, setDeparturePoint] = useState(initialDeparturePoint);
  const [arrivalMode, setArrivalMode] = useState<PointMode>(endpointMode(initialArrivalPoint));
  const [departureMode, setDepartureMode] = useState<DepartureMode>(
    initialArrivalPoint &&
      initialDeparturePoint?.googlePlaceId === initialArrivalPoint.googlePlaceId
      ? 'same'
      : endpointMode(initialDeparturePoint),
  );
  const [arrivalSearchOpen, setArrivalSearchOpen] = useState(false);
  const [departureSearchOpen, setDepartureSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = await phase2Fetch<{
        startDate: string | null;
        endDate: string | null;
        arrivalTime: string | null;
        departureTime: string | null;
        arrivalPoint: TripEndpoint | null;
        departurePoint: TripEndpoint | null;
      }>(`/api/trips/${tripId}/travel-boundaries`, {
        method: 'PATCH',
        body: JSON.stringify({
          startDate: arrivalDate || null,
          endDate: departureDate || null,
          arrivalTime: arrivalTime || null,
          departureTime: departureTime || null,
          arrivalPointMode: arrivalMode,
          arrivalPlaceId: arrivalMode === 'place' ? arrivalPoint?.googlePlaceId : undefined,
          departurePointMode: departureMode,
          departurePlaceId: departureMode === 'place' ? departurePoint?.googlePlaceId : undefined,
        }),
      });
      onSaved(payload);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'We could not save these travel times.',
      );
    } finally {
      setSaving(false);
    }
  }

  function selectPoint(place: PlaceCandidate, kind: 'arrival' | 'departure') {
    const point = {
      googlePlaceId: place.externalPlaceId,
      name: place.name,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
    };
    if (kind === 'arrival') {
      setArrivalPoint(point);
      setArrivalMode('place');
      setArrivalSearchOpen(false);
    } else {
      setDeparturePoint(point);
      setDepartureMode('place');
      setDepartureSearchOpen(false);
    }
  }

  return (
    <section className="w-full rounded-[2rem] border border-white/55 bg-[#f8f4ed]/90 p-5 text-ink shadow-[0_30px_90px_rgb(52_42_34/28%)] backdrop-blur-[18px] sm:p-6 lg:p-7">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_235px] lg:items-start">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-brown-accent">TRAVEL TIMES</p>
          <h1 className="mt-2 max-w-3xl font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            When is your group available?
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-warm-muted sm:text-base sm:leading-7">
            Help us plan the best itinerary by sharing your group&apos;s arrival and departure details in {destination}. You can skip anything you are not sure about yet.
          </p>
        </div>
        <aside className="hidden rounded-2xl border border-white/55 bg-white/30 p-4 text-sm leading-6 text-warm-muted lg:flex lg:gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-warm-border/80 bg-white/55 text-ink">
            <CalendarDays className="size-4" aria-hidden="true" />
          </span>
          <p>These times help us build a more realistic plan. You can always change them later.</p>
        </aside>
      </div>

      <div className="mt-4 divide-y divide-warm-border/75 border-y border-warm-border/75">
        <section className="py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-4">
              <PlaneLanding className="mt-0.5 size-7 shrink-0 text-brown-accent" aria-hidden="true" />
              <div>
                <h2 className="font-editorial text-2xl font-semibold">Arrival</h2>
                <p className="mt-1 text-sm text-warm-muted">When will you arrive in {destination}?</p>
              </div>
            </div>
            <button type="button" onClick={() => { setArrivalDate(''); setArrivalTime(''); }} className="shrink-0 rounded-full border border-warm-border/90 bg-white/30 px-4 py-2 text-xs font-semibold text-ink hover:bg-white/60">
              Skip / Not sure
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_0.9fr_1.35fr]">
            <BookingField icon={<CalendarDays className="size-5" aria-hidden="true" />} label="Date">
              <Input
                id="arrival-date"
                aria-label="Arrival date"
                type="date"
                value={arrivalDate}
                max={departureDate || undefined}
                onChange={(event) => setArrivalDate(event.target.value)}
                className="mt-0.5 h-7 border-0 bg-transparent p-0 text-sm font-medium shadow-none focus-visible:ring-0"
              />
            </BookingField>
            <BookingField icon={<Clock3 className="size-5" aria-hidden="true" />} label="Time">
              <Input id="arrival-time" type="time" value={arrivalTime} onChange={(event) => setArrivalTime(event.target.value)} className="mt-0.5 h-7 border-0 bg-transparent p-0 text-sm font-medium shadow-none focus-visible:ring-0" />
            </BookingField>
            <button type="button" onClick={() => { setArrivalMode('place'); setArrivalSearchOpen(true); }} aria-expanded={arrivalSearchOpen} className="flex min-h-16 items-center gap-3 rounded-2xl border border-warm-border/80 bg-white/62 px-4 text-left hover:bg-white/80">
              <MapPin className="size-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-warm-muted">Arrival point (optional)</span>
                <span className="mt-1 block truncate text-sm font-medium">{arrivalPoint?.name ?? 'Choose airport or station'}</span>
              </span>
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
          <button type="button" onClick={() => { setArrivalMode('skip'); setArrivalPoint(null); setArrivalSearchOpen(false); if (departureMode === 'same') setDepartureMode('skip'); }} className="mt-2 text-xs font-semibold text-warm-muted underline-offset-4 hover:text-ink hover:underline">
            Skip arrival point
          </button>
          {arrivalSearchOpen && <PointSearch tripId={tripId} label="Grounded arrival airport or transport point" selected={arrivalPoint} onSelect={(place) => selectPoint(place, 'arrival')} />}
        </section>

        <section className="py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-4">
              <PlaneTakeoff className="mt-0.5 size-7 shrink-0 text-brown-accent" aria-hidden="true" />
              <div>
                <h2 className="font-editorial text-2xl font-semibold">Departure</h2>
                <p className="mt-1 text-sm text-warm-muted">When do you need to leave {destination}?</p>
              </div>
            </div>
            <button type="button" onClick={() => { setDepartureDate(''); setDepartureTime(''); }} className="shrink-0 rounded-full border border-warm-border/90 bg-white/30 px-4 py-2 text-xs font-semibold text-ink hover:bg-white/60">
              Skip / Not sure
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_0.9fr_1.35fr]">
            <BookingField icon={<CalendarDays className="size-5" aria-hidden="true" />} label="Date">
              <Input
                id="departure-date"
                aria-label="Departure date"
                type="date"
                value={departureDate}
                min={arrivalDate || undefined}
                onChange={(event) => setDepartureDate(event.target.value)}
                className="mt-0.5 h-7 border-0 bg-transparent p-0 text-sm font-medium shadow-none focus-visible:ring-0"
              />
            </BookingField>
            <BookingField icon={<Clock3 className="size-5" aria-hidden="true" />} label="Time">
              <Input id="departure-time" type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} className="mt-0.5 h-7 border-0 bg-transparent p-0 text-sm font-medium shadow-none focus-visible:ring-0" />
            </BookingField>
            <button type="button" onClick={() => { setDepartureMode('place'); setDepartureSearchOpen(true); }} aria-expanded={departureSearchOpen} className="flex min-h-16 items-center gap-3 rounded-2xl border border-warm-border/80 bg-white/62 px-4 text-left hover:bg-white/80">
              <MapPin className="size-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-warm-muted">Departure point (optional)</span>
                <span className="mt-1 block truncate text-sm font-medium">{departureMode === 'same' ? arrivalPoint?.name : departurePoint?.name ?? 'Choose airport or station'}</span>
              </span>
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold">
            <button type="button" disabled={!arrivalPoint} onClick={() => { setDepartureMode('same'); setDepartureSearchOpen(false); }} className="text-brown-accent underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-40">Same as arrival point</button>
            <button type="button" onClick={() => { setDepartureMode('skip'); setDeparturePoint(null); setDepartureSearchOpen(false); }} className="text-warm-muted underline-offset-4 hover:text-ink hover:underline">Skip departure point</button>
          </div>
          {departureMode === 'same' && arrivalPoint && <p className="mt-3 text-xs font-semibold text-brown-accent">Departure point: {arrivalPoint.name}</p>}
          {departureSearchOpen && <PointSearch tripId={tripId} label="Grounded departure airport or transport point" selected={departurePoint} onSelect={(place) => selectPoint(place, 'departure')} />}
        </section>
      </div>

      {error && <SystemNotice role="alert" className="mt-5 border-brown-accent/30" title="We couldn’t save those travel details." description="Your previously saved trip details are unchanged. Check the values and try again." />}

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={() => void save()} disabled={saving} className="h-12 min-w-64 rounded-full bg-ink px-7 text-paper hover:bg-ink/90">
            {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {saving ? 'Saving travel boundaries…' : 'Continue to travel range'}
            {!saving && <ArrowRight aria-hidden="true" />}
          </Button>
          <Button type="button" variant="outline" onClick={onBack} disabled={saving} className="h-12 rounded-full border-warm-border bg-white/25 px-7 text-ink hover:bg-white/55">
            <ArrowLeft aria-hidden="true" />
            Back to destination
          </Button>
        </div>
        <p className="flex items-center gap-2 text-xs leading-5 text-warm-muted lg:max-w-60">
          <ShieldCheck className="size-5 shrink-0 text-ink" aria-hidden="true" />
          You can skip this step and edit it later in your trip settings.
        </p>
      </div>
    </section>
  );
}
