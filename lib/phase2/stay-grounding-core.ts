import type { PlaceCandidate } from './types';

const ACCOMMODATION_TYPES = new Set([
  'hotel',
  'lodging',
  'motel',
  'resort_hotel',
  'bed_and_breakfast',
  'hostel',
  'guest_house',
  'extended_stay_hotel',
]);

export type StayPlaceResolution =
  | { status: 'resolved'; place: PlaceCandidate }
  | { status: 'ambiguous'; candidates: PlaceCandidate[] }
  | { status: 'not_found'; candidates: [] };

export function isAccommodationPlace(place: PlaceCandidate) {
  return place.types.some((type) => ACCOMMODATION_TYPES.has(type));
}

function normalizedWords(value: string) {
  return value
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function nameMatchScore(query: string, name: string) {
  const queryWords = normalizedWords(query);
  const nameWords = new Set(normalizedWords(name));
  if (queryWords.length === 0) return 0;
  return (
    queryWords.filter((word) => nameWords.has(word)).length / queryWords.length
  );
}

export function selectStayPlaceResolution(
  query: string,
  candidates: PlaceCandidate[],
): StayPlaceResolution {
  const accommodations = candidates.filter(isAccommodationPlace);
  if (accommodations.length === 0) {
    return { status: 'not_found', candidates: [] };
  }
  if (accommodations.length === 1) {
    return { status: 'resolved', place: accommodations[0] };
  }

  const normalizedQuery = normalizedWords(query).join(' ');
  const ranked = accommodations
    .map((place) => ({
      place,
      score: nameMatchScore(query, place.name),
      exact: normalizedWords(place.name).join(' ') === normalizedQuery,
    }))
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) || right.score - left.score,
    );
  const first = ranked[0];
  const second = ranked[1];
  if (
    first.exact ||
    (first.score >= 0.75 && first.score - (second?.score ?? 0) >= 0.2)
  ) {
    return { status: 'resolved', place: first.place };
  }
  return {
    status: 'ambiguous',
    candidates: ranked.slice(0, 3).map(({ place }) => place),
  };
}
