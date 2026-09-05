import { Phase2ProviderError } from './provider-error';
import type { GoogleAddressComponent, PlaceCandidate } from './types';

const url = 'https://places.googleapis.com/v1/places:searchText';
const detailsUrl = 'https://places.googleapis.com/v1/places';
export const GOOGLE_PLACES_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types';

type GooglePlacePayload = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  types?: string[];
};

function apiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');
  return key;
}

export async function searchPlannerPlaces(query: string, destination: string, limit = 5): Promise<PlaceCandidate[]> {
  const key = apiKey();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK }, body: JSON.stringify({ textQuery: `${query} in ${destination}`, pageSize: Math.min(Math.max(limit, 3), 8), languageCode: 'en' }), cache: 'no-store' });
  if (!response.ok) throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');
  const payload = await response.json() as { places?: GooglePlacePayload[] };
  return (payload.places ?? []).flatMap((place) => place.id && place.displayName?.text && Number.isFinite(place.location?.latitude) && Number.isFinite(place.location?.longitude) ? [{ externalPlaceId: place.id, name: place.displayName.text, address: place.formattedAddress ?? null, addressComponents: place.addressComponents ?? [], latitude: place.location!.latitude!, longitude: place.location!.longitude!, rating: Number.isFinite(place.rating) ? place.rating! : null, ratingCount: Number.isInteger(place.userRatingCount) ? place.userRatingCount! : null, priceLevel: place.priceLevel ?? null, types: place.types ?? [] }] : []);
}

export async function getPlaceAddressDetails(placeId: string) {
  const response = await fetch(`${detailsUrl}/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'addressComponents,formattedAddress',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Phase2ProviderError('GOOGLE_PLACES_UNAVAILABLE');
  const place = await response.json() as GooglePlacePayload;
  return {
    addressComponents: place.addressComponents ?? [],
    formattedAddress: place.formattedAddress ?? null,
  };
}
