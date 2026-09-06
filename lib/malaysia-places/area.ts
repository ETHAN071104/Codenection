import type { GoogleAddressComponent } from '@/lib/phase2/types';

const AREA_NORMALIZATION: Record<string, string> = {
  'kuala lumpur city centre': 'KLCC',
  'kuala lumpur city center': 'KLCC',
  klcc: 'KLCC',
  'bukit bintang': 'Bukit Bintang',
  brickfields: 'Brickfields',
  chinatown: 'Chinatown',
  'petaling street': 'Chinatown',
};

const FORMATTED_ADDRESS_AREAS = Object.keys(AREA_NORMALIZATION).sort(
  (a, b) => b.length - a.length,
);
const GENERIC_CITY_VALUES = new Set([
  'kuala lumpur',
  'wilayah persekutuan kuala lumpur',
  'malaysia',
]);

function normalizeArea(value: string, genericValues = GENERIC_CITY_VALUES) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || genericValues.has(normalized.toLowerCase())) return null;
  return AREA_NORMALIZATION[normalized.toLowerCase()] ?? normalized;
}

function componentForType(components: GoogleAddressComponent[], type: string) {
  return components.find((component) => component.types?.includes(type));
}

/**
 * Derives an area only from Google address components or an explicit, factual
 * area token present in Google's formatted address. It never infers an area
 * from coordinates or falls back to the city name.
 */
export function deriveMalaysiaPlaceArea(
  addressComponents: GoogleAddressComponent[],
  formattedAddress: string | null,
  city?: string,
) {
  const genericValues = new Set(GENERIC_CITY_VALUES);
  if (city) {
    genericValues.add(city.trim().toLowerCase());
    genericValues.add(city.split(',')[0].trim().toLowerCase());
  }
  for (const type of ['neighborhood', 'sublocality_level_1', 'sublocality']) {
    const component = componentForType(addressComponents, type);
    const area = component?.longText
      ? normalizeArea(component.longText, genericValues)
      : null;
    if (area) return area;
  }
  const address = formattedAddress?.toLowerCase() ?? '';
  const matched = FORMATTED_ADDRESS_AREAS.find((area) =>
    address.includes(area),
  );
  return matched ? AREA_NORMALIZATION[matched] : null;
}
