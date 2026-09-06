'use client';

import { useState } from 'react';
import { LoaderCircle, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SystemNotice } from '@/components/ui/system-state';
import { phase2Fetch } from '@/lib/phase2/client';
import type { PlaceCandidate } from '@/lib/phase2/types';
import type { PlaceSearchResponse } from '@/lib/planner/types';

export function AddPlacePanel({
  tripId,
  day,
  disabled,
  onAdd,
  onClose,
}: {
  tripId: string;
  day: number;
  disabled: boolean;
  onAdd: (externalPlaceId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'empty' | 'search' | 'add'>(
    'search',
  );

  async function search(event: { preventDefault(): void }) {
    event.preventDefault();
    const cleaned = query.trim();
    if (cleaned.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const payload = await phase2Fetch<PlaceSearchResponse>(
        `/api/trips/${tripId}/places/search`,
        { method: 'POST', body: JSON.stringify({ query: cleaned }) },
      );
      setResults(payload.results);
      if (payload.results.length === 0) {
        setErrorKind('empty');
        setError('No matching places found. Try a more specific search.');
      }
    } catch (searchError) {
      setErrorKind('search');
      setError(
        searchError instanceof Error
          ? searchError.message
          : 'Place search is unavailable right now.',
      );
    } finally {
      setSearching(false);
    }
  }

  async function add(place: PlaceCandidate) {
    setAddingId(place.externalPlaceId);
    setError(null);
    try {
      await onAdd(place.externalPlaceId);
      onClose();
    } catch (addError) {
      setErrorKind('add');
      setError(
        addError instanceof Error
          ? addError.message
          : 'We could not add that place.',
      );
    } finally {
      setAddingId(null);
    }
  }

  return (
    <section className="border-b border-[#35383d]/25 bg-[#fffdf8] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Add a real place</h3>
          <p className="mt-1 text-xs leading-5 text-[#5a5d61]">
            Search Google Places and add a stop to Day {day}.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close place search"
          onClick={onClose}
          className="p-1 text-[#5a5d61] outline-none hover:text-[#25282d] focus-visible:ring-2 focus-visible:ring-[#2f3237]"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <form className="mt-4 flex gap-2" onSubmit={search}>
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5a5d61]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="cafe near Alfama"
            aria-label="Search for a place"
            disabled={disabled || searching}
            className="h-10 rounded-none border-[#35383d]/35 bg-[#f7f3e8] pl-9 text-[#25282d] placeholder:text-[#5a5d61]"
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || searching || query.trim().length < 2}
          className="h-10 rounded-none bg-[#2f3237] px-4 text-[#f8f4e8] hover:bg-[#1f2227]"
        >
          {searching ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            'Search'
          )}
        </Button>
      </form>

      {error && (
        <SystemNotice
          role={errorKind === 'empty' ? 'status' : 'alert'}
          className="mt-3 bg-parchment px-3 py-2.5"
          title={
            errorKind === 'empty'
              ? 'No matching places yet.'
              : errorKind === 'add'
                ? 'That place wasn’t added.'
                : 'Place search is unavailable.'
          }
          description={
            errorKind === 'add'
              ? 'Your itinerary is unchanged. Try adding the place again.'
              : errorKind === 'empty'
                ? 'Your itinerary is unchanged. Try a more specific name or area in the search above.'
                : 'Your itinerary is unchanged. Check your connection and try the search again.'
          }
        />
      )}

      {results.length > 0 && (
        <div className="mt-4 border-t border-[#35383d]/20">
          {results.map((place) => (
            <div
              key={place.externalPlaceId}
              className="flex items-start gap-3 border-b border-[#35383d]/15 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{place.name}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#5a5d61]">
                  {place.address ?? 'Address unavailable'}
                </p>
                {place.rating !== null && (
                  <p className="mt-1 text-xs text-[#5a5d61]">
                    {place.rating.toFixed(1)} Google rating
                  </p>
                )}
              </div>
              <Button
                type="button"
                aria-label={`Add ${place.name} to Day ${day}`}
                disabled={disabled || addingId !== null}
                onClick={() => void add(place)}
                className="h-9 shrink-0 rounded-none border border-[#2f3237] bg-transparent px-3 text-[#25282d] hover:bg-[#e7e0cd]"
              >
                {addingId === place.externalPlaceId ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                <span className="sr-only">Add to Day {day}</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
