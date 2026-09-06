'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, MapPin, Search } from 'lucide-react';
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
    <div className="mt-4 rounded-xl border border-warm-border bg-parchment p-4">
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
            className="h-11 rounded-xl border-warm-border bg-paper"
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
                <span className="block text-sm font-semibold text-ink">
                  {place.name}
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-warm-muted">
                  {place.address ?? 'Address unavailable'}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-brown-accent">
                Choose
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TravelBoundariesStep({
  tripId,
  destination,
  initialArrivalTime,
  initialDepartureTime,
  initialArrivalPoint,
  initialDeparturePoint,
  onSaved,
  onBack,
}: {
  tripId: string;
  destination: string;
  initialArrivalTime: string | null;
  initialDepartureTime: string | null;
  initialArrivalPoint: TripEndpoint | null;
  initialDeparturePoint: TripEndpoint | null;
  onSaved: (value: {
    arrivalTime: string | null;
    departureTime: string | null;
    arrivalPoint: TripEndpoint | null;
    departurePoint: TripEndpoint | null;
  }) => void;
  onBack: () => void;
}) {
  const [arrivalTime, setArrivalTime] = useState(initialArrivalTime ?? '');
  const [departureTime, setDepartureTime] = useState(initialDepartureTime ?? '');
  const [arrivalPoint, setArrivalPoint] = useState(initialArrivalPoint);
  const [departurePoint, setDeparturePoint] = useState(initialDeparturePoint);
  const [arrivalMode, setArrivalMode] = useState<PointMode>(
    endpointMode(initialArrivalPoint),
  );
  const [departureMode, setDepartureMode] = useState<DepartureMode>(
    initialArrivalPoint &&
      initialDeparturePoint?.googlePlaceId === initialArrivalPoint.googlePlaceId
      ? 'same'
      : endpointMode(initialDeparturePoint),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = await phase2Fetch<{
        arrivalTime: string | null;
        departureTime: string | null;
        arrivalPoint: TripEndpoint | null;
        departurePoint: TripEndpoint | null;
      }>(`/api/trips/${tripId}/travel-boundaries`, {
        method: 'PATCH',
        body: JSON.stringify({
          arrivalTime: arrivalTime || null,
          departureTime: departureTime || null,
          arrivalPointMode: arrivalMode,
          arrivalPlaceId:
            arrivalMode === 'place' ? arrivalPoint?.googlePlaceId : undefined,
          departurePointMode: departureMode,
          departurePlaceId:
            departureMode === 'place'
              ? departurePoint?.googlePlaceId
              : undefined,
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

  return (
    <>
      <h1 className="mt-4 font-editorial text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
        When is your group available?
      </h1>
      <p className="mt-5 max-w-2xl leading-7 text-warm-muted">
        Optional arrival and departure details keep the first and final day in
        {` ${destination}`} realistic. Skip anything you do not know yet.
      </p>

      <div className="mt-8 space-y-8">
        <section>
          <label htmlFor="arrival-time" className="text-sm font-semibold text-ink">
            When will you arrive at the destination?
          </label>
          <div className="mt-2 flex items-center gap-3">
            <Input
              id="arrival-time"
              type="time"
              value={arrivalTime}
              onChange={(event) => setArrivalTime(event.target.value)}
              className="h-12 max-w-48 rounded-xl border-warm-border bg-paper"
            />
            <button
              type="button"
              onClick={() => setArrivalTime('')}
              className="text-sm font-semibold text-warm-muted hover:text-ink"
            >
              Skip / Not sure
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setArrivalMode('place')}
              className="h-10 rounded-xl border-warm-border"
            >
              Choose arrival point
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setArrivalMode('skip');
                setArrivalPoint(null);
                if (departureMode === 'same') setDepartureMode('skip');
              }}
              className="h-10 rounded-xl text-warm-muted"
            >
              Skip point
            </Button>
          </div>
          {arrivalMode === 'place' && (
            <PointSearch
              tripId={tripId}
              label="Grounded arrival airport or transport point"
              selected={arrivalPoint}
              onSelect={(place) => {
                setArrivalPoint({
                  googlePlaceId: place.externalPlaceId,
                  name: place.name,
                  address: place.address,
                  latitude: place.latitude,
                  longitude: place.longitude,
                });
              }}
            />
          )}
        </section>

        <section className="border-t border-warm-border pt-7">
          <label htmlFor="departure-time" className="text-sm font-semibold text-ink">
            When do you need to leave the destination?
          </label>
          <div className="mt-2 flex items-center gap-3">
            <Input
              id="departure-time"
              type="time"
              value={departureTime}
              onChange={(event) => setDepartureTime(event.target.value)}
              className="h-12 max-w-48 rounded-xl border-warm-border bg-paper"
            />
            <button
              type="button"
              onClick={() => setDepartureTime('')}
              className="text-sm font-semibold text-warm-muted hover:text-ink"
            >
              Skip / Not sure
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!arrivalPoint}
              onClick={() => setDepartureMode('same')}
              className="h-10 rounded-xl border-warm-border"
            >
              Same as arrival point
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDepartureMode('place')}
              className="h-10 rounded-xl border-warm-border"
            >
              Choose another point
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDepartureMode('skip');
                setDeparturePoint(null);
              }}
              className="h-10 rounded-xl text-warm-muted"
            >
              Skip point
            </Button>
          </div>
          {departureMode === 'same' && arrivalPoint && (
            <p className="mt-3 text-sm font-semibold text-brown-accent">
              Departure point: {arrivalPoint.name}
            </p>
          )}
          {departureMode === 'place' && (
            <PointSearch
              tripId={tripId}
              label="Grounded departure airport or transport point"
              selected={departurePoint}
              onSelect={(place) => {
                setDeparturePoint({
                  googlePlaceId: place.externalPlaceId,
                  name: place.name,
                  address: place.address,
                  latitude: place.latitude,
                  longitude: place.longitude,
                });
              }}
            />
          )}
        </section>
      </div>

      {error && (
        <SystemNotice
          role="alert"
          className="mt-6 border-brown-accent/30"
          title="We couldn’t save those travel details."
          description="Your previously saved trip details are unchanged. Check the values and try again."
        />
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving || (arrivalMode === 'place' && !arrivalPoint) || (departureMode === 'place' && !departurePoint)}
          className="h-11 rounded-xl bg-ink px-5 text-paper hover:bg-ink/90"
        >
          {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Continue to travel range
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={saving}
          className="h-11 rounded-xl border-warm-border bg-paper px-5 text-ink"
        >
          <ArrowLeft aria-hidden="true" />
          Back to destination
        </Button>
      </div>
    </>
  );
}
