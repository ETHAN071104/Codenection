import type { GooglePlacePhotoAttribution } from '@/lib/phase2/types';

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
