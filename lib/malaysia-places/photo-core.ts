import type { GooglePlacePhotoAttribution } from '@/lib/phase2/types';

export const CANDIDATE_PLACE_PHOTO_WIDTH_PX = 900;

export function parsePlacePhotoAttributions(
  value: unknown,
): GooglePlacePhotoAttribution[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('displayName' in entry) ||
      typeof entry.displayName !== 'string' ||
      !entry.displayName.trim()
    ) {
      return [];
    }
    return [
      {
        displayName: entry.displayName,
        uri:
          'uri' in entry && typeof entry.uri === 'string' ? entry.uri : null,
        photoUri:
          'photoUri' in entry && typeof entry.photoUri === 'string'
            ? entry.photoUri
            : null,
      },
    ];
  });
}

export function hasUsablePlacePhoto(place: { photoName: string | null }) {
  return Boolean(place.photoName?.startsWith('places/'));
}

export function googlePlacePhotoMediaRequestUrl(photoName: string) {
  const encodedName = photoName.split('/').map(encodeURIComponent).join('/');
  const url = new URL(
    `https://places.googleapis.com/v1/${encodedName}/media`,
  );
  url.searchParams.set(
    'maxWidthPx',
    String(CANDIDATE_PLACE_PHOTO_WIDTH_PX),
  );
  url.searchParams.set('skipHttpRedirect', 'true');
  return url.toString();
}

export function isTrustedGooglePhotoUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return (
      url.hostname === 'googleusercontent.com' ||
      url.hostname.endsWith('.googleusercontent.com') ||
      url.hostname === 'ggpht.com' ||
      url.hostname.endsWith('.ggpht.com')
    );
  } catch {
    return false;
  }
}
