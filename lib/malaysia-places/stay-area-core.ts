import type { CandidatePlace } from './types';

// `placeWeight = 1 + (vote share × 2) + (group score / 100 × 1.5)`.
// Votes lead the decision; the existing group score is a smaller secondary signal.
export const STAY_AREA_WEIGHTING = {
  base: 1,
  voteShareMultiplier: 2,
  groupScoreMultiplier: 1.5,
} as const;

export type StayAreaSelection = CandidatePlace & {
  voteCount: number;
  totalMembers: number;
  groupScore: number;
};

export type StayAreaOption = {
  area: string;
  score: number;
  weightedDistanceKm: number;
  selectedPlaceCount: number;
};

export type StayAreaRecommendation = {
  status: 'ready' | 'no_selection' | 'area_data_unavailable' | 'coordinate_data_unavailable';
  weightedCenter: { latitude: number; longitude: number } | null;
  recommendedArea: StayAreaOption | null;
  alternativeArea: StayAreaOption | null;
  reasons: string[];
  confidence: 'low' | 'medium' | 'high' | null;
  spreadKm: number | null;
  excludedPlaceCount: number;
};

type Coordinate = { latitude: number; longitude: number };
type CandidateArea = Coordinate & { area: string };

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: Coordinate, b: Coordinate) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function hasCoordinates(place: Pick<CandidatePlace, 'latitude' | 'longitude'>): place is Pick<CandidatePlace, 'latitude' | 'longitude'> & Coordinate {
  return place.latitude !== null && place.longitude !== null;
}

function round(value: number, precision = 1) {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function emptyRecommendation(status: StayAreaRecommendation['status'], excludedPlaceCount: number): StayAreaRecommendation {
  return {
    status,
    weightedCenter: null,
    recommendedArea: null,
    alternativeArea: null,
    reasons: [],
    confidence: null,
    spreadKm: null,
    excludedPlaceCount,
  };
}

function placeWeight(place: StayAreaSelection) {
  const voteShare = place.totalMembers > 0 ? place.voteCount / place.totalMembers : 0;
  return STAY_AREA_WEIGHTING.base + voteShare * STAY_AREA_WEIGHTING.voteShareMultiplier + (place.groupScore / 100) * STAY_AREA_WEIGHTING.groupScoreMultiplier;
}

function areaCentroids(places: CandidatePlace[]) {
  const areas = new Map<string, CandidateArea[]>();
  for (const place of places) {
    if (!place.area?.trim() || !hasCoordinates(place)) continue;
    const area = place.area.trim();
    areas.set(area, [...(areas.get(area) ?? []), { area, latitude: place.latitude, longitude: place.longitude }]);
  }
  return [...areas.entries()].map(([area, coordinates]) => ({
    area,
    latitude: coordinates.reduce((sum, point) => sum + point.latitude, 0) / coordinates.length,
    longitude: coordinates.reduce((sum, point) => sum + point.longitude, 0) / coordinates.length,
  }));
}

export function getStayAreaRecommendation(selectedPlaces: StayAreaSelection[], knownPlaces: CandidatePlace[]): StayAreaRecommendation {
  if (!selectedPlaces.length) return emptyRecommendation('no_selection', 0);

  const selectedWithCoordinates = selectedPlaces.filter(
    (place): place is StayAreaSelection & Coordinate => hasCoordinates(place),
  );
  const excludedPlaceCount = selectedPlaces.length - selectedWithCoordinates.length;
  if (!selectedWithCoordinates.length) return emptyRecommendation('coordinate_data_unavailable', excludedPlaceCount);

  const candidates = areaCentroids(knownPlaces);
  if (!candidates.length) return emptyRecommendation('area_data_unavailable', excludedPlaceCount);

  const totalWeight = selectedWithCoordinates.reduce((sum, place) => sum + placeWeight(place), 0);
  const weightedCenter = {
    latitude: selectedWithCoordinates.reduce((sum, place) => sum + place.latitude * placeWeight(place), 0) / totalWeight,
    longitude: selectedWithCoordinates.reduce((sum, place) => sum + place.longitude * placeWeight(place), 0) / totalWeight,
  };
  const spreadKm = selectedWithCoordinates.reduce((sum, place) => sum + haversineKm(weightedCenter, place) * placeWeight(place), 0) / totalWeight;
  const scored = candidates.map((candidate) => ({
    area: candidate.area,
    weightedDistanceKm: selectedWithCoordinates.reduce((sum, place) => sum + haversineKm(candidate, place) * placeWeight(place), 0) / totalWeight,
    selectedPlaceCount: selectedPlaces.filter((place) => place.area?.trim() === candidate.area).length,
  })).sort((a, b) => a.weightedDistanceKm - b.weightedDistanceKm || b.selectedPlaceCount - a.selectedPlaceCount || a.area.localeCompare(b.area));
  const worstDistance = Math.max(...scored.map((candidate) => candidate.weightedDistanceKm), 0.1);
  const options: StayAreaOption[] = scored.map((candidate) => ({
    ...candidate,
    weightedDistanceKm: round(candidate.weightedDistanceKm),
    score: scored.length === 1 ? 100 : Math.round(Math.max(0, Math.min(100, 100 * (1 - candidate.weightedDistanceKm / worstDistance)))),
  }));
  const recommendedArea = options[0];
  const alternativeArea = options[1] ?? null;
  const confidence = selectedPlaces.length === 1 || spreadKm > 8 ? 'low' : spreadKm > 4 ? 'medium' : 'high';
  const reasons = [
    `Closest available area to the weighted center of your selected places (${round(haversineKm(weightedCenter, candidates.find((candidate) => candidate.area === recommendedArea.area)!))} km away).`,
    `Estimated weighted travel burden is ${recommendedArea.weightedDistanceKm} km.`,
  ];
  if (recommendedArea.selectedPlaceCount) reasons.unshift(`${recommendedArea.selectedPlaceCount} selected place${recommendedArea.selectedPlaceCount === 1 ? '' : 's'} already belong to ${recommendedArea.area}.`);
  if (alternativeArea) reasons.push(`${recommendedArea.area} has a lower geographic burden than ${alternativeArea.area}.`);
  if (selectedPlaces.length === 1) reasons.push('Low confidence: this is based on one selected place.');
  else if (spreadKm > 8) reasons.push('Lower confidence: your selected places are spread across Kuala Lumpur.');
  if (excludedPlaceCount) reasons.push(`${excludedPlaceCount} selected place${excludedPlaceCount === 1 ? '' : 's'} had no coordinates and was excluded.`);

  return {
    status: 'ready',
    weightedCenter: { latitude: round(weightedCenter.latitude, 6), longitude: round(weightedCenter.longitude, 6) },
    recommendedArea,
    alternativeArea,
    reasons: reasons.slice(0, 4),
    confidence,
    spreadKm: round(spreadKm),
    excludedPlaceCount,
  };
}
