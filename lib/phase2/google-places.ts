import 'server-only';

import { Phase2ProviderError } from './openrouter';
import type { PlaceCandidate, SearchRequest } from './types';

const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';

export const GOOGLE_PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.types',
].join(',');

type GooglePlace = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  rating?: unknown;
  userRatingCount?: unknown;
  priceLevel?: unknown;
  types?: unknown;
};

function normalizePlace(place: GooglePlace): PlaceCandidate | null {
  const externalPlaceId = typeof place.id === 'string' ? place.id.trim() : '';
  const name =
    typeof place.displayName?.text === 'string'
      ? place.displayName.text.trim()
      : '';
  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);

  if (
    !externalPlaceId ||
    !name ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const rating = Number(place.rating);
  const ratingCount = Number(place.userRatingCount);

  return {
    externalPlaceId,
    name,
    address:
      typeof place.formattedAddress === 'string'
        ? place.formattedAddress
        : null,
    latitude,
    longitude,
    rating: Number.isFinite(rating) ? rating : null,
    ratingCount: Number.isInteger(ratingCount) ? ratingCount : null,
    priceLevel: typeof place.priceLevel === 'string' ? place.priceLevel : null,
    types: Array.isArray(place.types)
      ? place.types.filter((type): type is string => typeof type === 'string')
      : [],
  };
}

export async function searchPlannerPlaces(
  query: string,
  destination: string,
  limit = 5,
) {
  return searchPlaces(
    {
      query,
      category: 'planner',
      desiredCount: Math.min(Math.max(limit, 3), 5),
    },
    destination,
  );
}

export async function getPlaceCandidateById(externalPlaceId: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');

  let response: Response;
  try {
    response = await fetch(
      `${GOOGLE_PLACE_DETAILS_URL}/${encodeURIComponent(externalPlaceId)}`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,location,rating,userRatingCount,priceLevel,types',
        },
        cache: 'no-store',
      },
    );
  } catch {
    throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');
  }

  if (!response.ok) {
    throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');
  }
  const candidate = normalizePlace((await response.json()) as GooglePlace);
  if (!candidate || candidate.externalPlaceId !== externalPlaceId) {
    throw new Phase2ProviderError('NO_PLACE_CANDIDATES');
  }
  return candidate;
}

async function searchPlaces(
  search: SearchRequest,
  destination: string,
): Promise<PlaceCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');

  let response: Response;
  try {
    response = await fetch(GOOGLE_PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `${search.query} in ${destination}`,
        pageSize: Math.min(Math.max(search.desiredCount, 3), 8),
        languageCode: 'en',
      }),
      cache: 'no-store',
    });
  } catch {
    throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');
  }

  if (!response.ok) {
    throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');
  }

  const payload = (await response.json()) as { places?: GooglePlace[] };
  return (payload.places ?? [])
    .map(normalizePlace)
    .filter((place): place is PlaceCandidate => place !== null);
}

export async function findPlaceCandidates(
  searches: SearchRequest[],
  destination: string,
) {
  const limitedSearches = searches.slice(0, 4);
  const results = await Promise.all(
    limitedSearches.map(async (search) =>
      (await searchPlaces(search, search.area ?? destination)).map((place) => ({
        ...place,
        sourceArea: search.area ?? destination,
      })),
    ),
  );
  const candidates = Array.from(
    new Map(
      results.flat().map((place) => [place.externalPlaceId, place]),
    ).values(),
  );

  if (candidates.length === 0) {
    throw new Phase2ProviderError('NO_PLACE_CANDIDATES');
  }

  return { candidates, callCount: limitedSearches.length };
}
