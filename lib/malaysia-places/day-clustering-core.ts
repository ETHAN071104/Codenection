import type { CandidatePlace } from './types';

export type DayClusterSelection = CandidatePlace & {
  voteCount: number;
  totalMembers: number;
  groupScore: number;
};

export type GeographicDayGroup = {
  day: number;
  places: DayClusterSelection[];
  centroid: { latitude: number; longitude: number } | null;
  placeCount: number;
  geographicSpreadKm: number | null;
  missingCoordinatePlaceCount: number;
};

export type GeographicDayClustering = {
  status: 'ready' | 'no_selection';
  days: GeographicDayGroup[];
  activeDays: number;
  unlocatedPlaceCount: number;
};

type Coordinate = { latitude: number; longitude: number };
type WorkingCluster = { places: DayClusterSelection[]; seed: DayClusterSelection };

const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(a: Coordinate, b: Coordinate) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function hasCoordinates(place: Pick<CandidatePlace, 'latitude' | 'longitude'>): place is Pick<CandidatePlace, 'latitude' | 'longitude'> & Coordinate {
  return place.latitude !== null && place.longitude !== null;
}

function comparePriority(a: DayClusterSelection, b: DayClusterSelection) {
  return b.voteCount - a.voteCount || b.groupScore - a.groupScore || b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function centroid(places: DayClusterSelection[]) {
  const located = places.filter((place): place is DayClusterSelection & Coordinate => hasCoordinates(place));
  if (!located.length) return null;
  return {
    latitude: located.reduce((sum, place) => sum + place.latitude, 0) / located.length,
    longitude: located.reduce((sum, place) => sum + place.longitude, 0) / located.length,
  };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function areaCentroid(area: string | null, knownPlaces: CandidatePlace[]) {
  if (!area) return null;
  return centroid(knownPlaces.filter((place) => place.area === area) as DayClusterSelection[]);
}

function createDayGroup(day: number, places: DayClusterSelection[]): GeographicDayGroup {
  const clusterCentroid = centroid(places);
  const located = places.filter((place): place is DayClusterSelection & Coordinate => hasCoordinates(place));
  const spread = clusterCentroid && located.length
    ? Math.max(...located.map((place) => haversineDistanceKm(clusterCentroid, place)))
    : null;
  return {
    day,
    places: [...places].sort(comparePriority),
    centroid: clusterCentroid ? { latitude: round(clusterCentroid.latitude), longitude: round(clusterCentroid.longitude) } : null,
    placeCount: places.length,
    geographicSpreadKm: spread === null ? null : round(spread),
    missingCoordinatePlaceCount: places.length - located.length,
  };
}

/**
 * Deterministic day grouping:
 * 1. Seed with the highest-priority place, then farthest-point seeds.
 * 2. Assign remaining places to the nearest cluster while capping a cluster
 *    at ceil(located places / active days), keeping groups reasonably balanced.
 * 3. Assign coordinate-less places by matching their factual area, otherwise
 *    to the smallest deterministic cluster. Days are ordered by distance to
 *    the recommended stay-area centroid, then by priority and coordinates.
 */
export function clusterSelectedPlacesByDay(
  selectedPlaces: DayClusterSelection[],
  activeDays: number,
  knownPlaces: CandidatePlace[],
  recommendedStayArea: string | null,
): GeographicDayClustering {
  const normalizedDays = Math.max(1, Math.floor(activeDays));
  if (!selectedPlaces.length) {
    return { status: 'no_selection', activeDays: normalizedDays, unlocatedPlaceCount: 0, days: Array.from({ length: normalizedDays }, (_, index) => createDayGroup(index + 1, [])) };
  }

  const located = selectedPlaces.filter((place): place is DayClusterSelection & Coordinate => hasCoordinates(place)).sort(comparePriority);
  const unlocated = selectedPlaces.filter((place) => !hasCoordinates(place)).sort(comparePriority);
  const clusterCount = Math.min(normalizedDays, located.length);
  const clusters: WorkingCluster[] = [];
  if (located.length) {
    const seeds = [located[0]];
    while (seeds.length < clusterCount) {
      const next = located
        .filter((place) => !seeds.some((seed) => seed.id === place.id))
        .map((place) => ({ place, distance: Math.min(...seeds.map((seed) => haversineDistanceKm(place, seed))) }))
        .sort((a, b) => b.distance - a.distance || comparePriority(a.place, b.place))[0]?.place;
      if (!next) break;
      seeds.push(next);
    }
    clusters.push(...seeds.map((seed) => ({ seed, places: [seed] })));
    const capacity = Math.ceil(located.length / clusterCount);
    for (const place of located.filter((candidate) => !seeds.some((seed) => seed.id === candidate.id))) {
      const available = clusters.filter((cluster) => cluster.places.length < capacity);
      const choices = available.length ? available : clusters;
      choices.sort((a, b) => haversineDistanceKm(place, centroid(a.places)!) - haversineDistanceKm(place, centroid(b.places)!) || comparePriority(a.seed, b.seed));
      choices[0].places.push(place);
    }
  }

  if (!clusters.length && unlocated.length) {
    const missingClusterCount = Math.min(normalizedDays, unlocated.length);
    clusters.push(...unlocated.slice(0, missingClusterCount).map((place) => ({ seed: place, places: [place] })));
    for (const place of unlocated.slice(missingClusterCount)) {
      const choice = [...clusters].sort((a, b) => a.places.length - b.places.length || comparePriority(a.seed, b.seed))[0];
      choice.places.push(place);
    }
  } else {
    for (const place of unlocated) {
      const areaMatches = clusters.filter((cluster) => cluster.places.some((member) => member.area && member.area === place.area));
      const choices = areaMatches.length ? areaMatches : clusters;
      const choice = [...choices].sort((a, b) => a.places.length - b.places.length || comparePriority(a.seed, b.seed))[0];
      choice.places.push(place);
    }
  }

  const stayAreaCenter = areaCentroid(recommendedStayArea, knownPlaces);
  const orderedClusters = [...clusters].sort((a, b) => {
    const aCenter = centroid(a.places);
    const bCenter = centroid(b.places);
    const aDistance = stayAreaCenter && aCenter ? haversineDistanceKm(stayAreaCenter, aCenter) : Number.POSITIVE_INFINITY;
    const bDistance = stayAreaCenter && bCenter ? haversineDistanceKm(stayAreaCenter, bCenter) : Number.POSITIVE_INFINITY;
    const aPriority = a.places.reduce((sum, place) => sum + place.groupScore, 0);
    const bPriority = b.places.reduce((sum, place) => sum + place.groupScore, 0);
    return aDistance - bDistance || bPriority - aPriority || (aCenter?.latitude ?? Number.POSITIVE_INFINITY) - (bCenter?.latitude ?? Number.POSITIVE_INFINITY) || (aCenter?.longitude ?? Number.POSITIVE_INFINITY) - (bCenter?.longitude ?? Number.POSITIVE_INFINITY) || comparePriority(a.seed, b.seed);
  });
  const days = orderedClusters.map((cluster, index) => createDayGroup(index + 1, cluster.places));
  while (days.length < normalizedDays) days.push(createDayGroup(days.length + 1, []));
  return { status: 'ready', days, activeDays: normalizedDays, unlocatedPlaceCount: unlocated.length };
}
