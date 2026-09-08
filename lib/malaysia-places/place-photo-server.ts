import 'server-only';

import {
  googlePlacePhotoMediaRequestUrl,
  isTrustedGooglePhotoUrl,
} from '@/lib/malaysia-places/photo-core';
import type {
  GooglePlacePhoto,
  GooglePlacePhotoAttribution,
} from '@/lib/phase2/types';

type GooglePhotoMediaResponse = { photoUri?: unknown };
type GooglePlaceDetailsResponse = { photos?: unknown };

function parseAttributions(value: unknown): GooglePlacePhotoAttribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const displayName = Reflect.get(entry, 'displayName');
    if (typeof displayName !== 'string' || !displayName.trim()) return [];
    const uri = Reflect.get(entry, 'uri');
    const photoUri = Reflect.get(entry, 'photoUri');
    return [
      {
        displayName,
        uri: typeof uri === 'string' ? uri : null,
        photoUri: typeof photoUri === 'string' ? photoUri : null,
      },
    ];
  });
}

function parsePhoto(value: unknown): GooglePlacePhoto | null {
  if (!value || typeof value !== 'object') return null;
  const name = Reflect.get(value, 'name');
  if (typeof name !== 'string' || !name.startsWith('places/')) return null;
  const widthPx = Reflect.get(value, 'widthPx');
  const heightPx = Reflect.get(value, 'heightPx');
  return {
    name,
    widthPx: typeof widthPx === 'number' ? widthPx : null,
    heightPx: typeof heightPx === 'number' ? heightPx : null,
    attributions: parseAttributions(Reflect.get(value, 'authorAttributions')),
  };
}

export async function resolveGooglePlacePhotoUrl(
  photoName: string,
  apiKey: string,
) {
  const response = await fetch(googlePlacePhotoMediaRequestUrl(photoName), {
    headers: { 'X-Goog-Api-Key': apiKey },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | GooglePhotoMediaResponse
    | null;
  return typeof payload?.photoUri === 'string' &&
    isTrustedGooglePhotoUrl(payload.photoUri)
    ? payload.photoUri
    : null;
}

export async function refreshGooglePlacePhotoMetadata(
  googlePlaceId: string,
  apiKey: string,
) {
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`,
    {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'photos',
      },
      cache: 'no-store',
    },
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | GooglePlaceDetailsResponse
    | null;
  const photos = Array.isArray(payload?.photos) ? payload.photos : [];
  return parsePhoto(photos[0]);
}
