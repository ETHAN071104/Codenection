import { createHash } from 'node:crypto';

import type { GeographicDayClustering } from './day-clustering-core';
import type { DeterministicDraftSchedule } from './deterministic-scheduling-core';
import type { RankedCandidate } from './group-ranking';
import type {
  ItineraryView,
  PersistedItineraryItem,
  PlaceCandidate,
} from '@/lib/phase2/types';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type Phase9ItineraryBridgePayload = {
  places: PlaceCandidate[];
  items: PersistedItineraryItem[];
  canonicalSignature: string;
};

export class Phase9ItineraryBridgeError extends Error {
  readonly placeName: string | null;

  constructor(message: string, placeName: string | null = null) {
    super(message);
    this.name = 'Phase9ItineraryBridgeError';
    this.placeName = placeName;
  }
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function clean(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') || null;
}

function validLatitude(value: number | null): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

function validLongitude(value: number | null): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

function dayTheme(
  grouping: GeographicDayClustering,
  day: number,
  destination: string,
) {
  const group = grouping.days.find((candidate) => candidate.day === day);
  const areas = Array.from(
    new Set(
      (group?.places ?? [])
        .map((place) => clean(place.area))
        .filter((area): area is string => Boolean(area)),
    ),
  );
  const focus = areas.slice(0, 2).join(' & ') || clean(destination) || 'Trip';
  return `Day ${day}: ${focus}`;
}

function conciseReason(
  candidate: RankedCandidate,
  schedulingReasons: string[],
) {
  const scheduleReason = schedulingReasons.find(
    (reason) =>
      !reason.startsWith('Uses ') &&
      !reason.includes('Haversine transition buffer'),
  );
  const parts = [candidate.reasons[0], scheduleReason]
    .map((reason) => clean(reason))
    .filter((reason): reason is string => Boolean(reason));
  const reason = Array.from(new Set(parts)).join(' ');
  return (
    reason ||
    'Selected by the group and placed in the deterministic trip schedule.'
  ).slice(0, 320);
}

function canonicalRows(
  items: Array<{
    externalPlaceId: string;
    day: number;
    sortOrder: number;
    plannedTime: string;
    estimatedDurationMinutes: number;
  }>,
) {
  return [...items]
    .map((item) => ({
      externalPlaceId: item.externalPlaceId,
      day: item.day,
      sortOrder: item.sortOrder,
      plannedTime: item.plannedTime.slice(0, 5),
      durationMinutes: item.estimatedDurationMinutes,
    }))
    .sort(
      (a, b) =>
        a.day - b.day ||
        a.sortOrder - b.sortOrder ||
        a.externalPlaceId.localeCompare(b.externalPlaceId),
    );
}

export function createScheduleFingerprint(
  schedule: DeterministicDraftSchedule,
  selected: RankedCandidate[],
) {
  return hash({
    selected: [...selected]
      .map((place) => ({
        id: place.id,
        googlePlaceId: place.googlePlaceId,
        voteCount: place.voteCount,
        totalMembers: place.totalMembers,
        recommendationScore: place.score,
        groupScore: place.groupScore,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    schedule: schedule.days.map((day) => ({
      day: day.day,
      items: day.items.map((item) => ({
        placeId: item.placeId,
        startTime: item.startTime,
        endTime: item.endTime,
        durationMinutes: item.durationMinutes,
      })),
      breaks: day.breaks.map((item) => ({
        label: item.label,
        startTime: item.startTime,
        endTime: item.endTime,
      })),
      overflow: day.overflow.map((item) => ({
        placeId: item.placeId,
        durationMinutes: item.durationMinutes,
      })),
    })),
  });
}

export function normalizePhase9Itinerary({
  destination,
  candidates,
  grouping,
  schedule,
}: {
  destination: string;
  candidates: RankedCandidate[];
  grouping: GeographicDayClustering;
  schedule: DeterministicDraftSchedule;
}): Phase9ItineraryBridgePayload {
  if (schedule.status !== 'ready' || schedule.scheduledPlaceCount < 1) {
    throw new Phase9ItineraryBridgeError(
      'Choose at least one place before opening the map plan.',
    );
  }

  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const seenPlaceIds = new Set<string>();
  const seenExternalPlaceIds = new Set<string>();
  const placesByGoogleId = new Map<string, PlaceCandidate>();
  const items: PersistedItineraryItem[] = [];

  for (const day of schedule.days) {
    if (!Number.isInteger(day.day) || day.day < 1) {
      throw new Phase9ItineraryBridgeError(
        'The schedule contains an invalid day.',
      );
    }

    for (const [sortOrder, scheduled] of day.items.entries()) {
      const candidate = candidatesById.get(scheduled.placeId);
      const placeName = candidate?.name ?? scheduled.name;
      if (!candidate) {
        throw new Phase9ItineraryBridgeError(
          `${placeName} is no longer available in the curated place list.`,
          placeName,
        );
      }
      if (seenPlaceIds.has(candidate.id)) {
        throw new Phase9ItineraryBridgeError(
          `${candidate.name} appears more than once in the schedule.`,
          candidate.name,
        );
      }
      seenPlaceIds.add(candidate.id);

      const externalPlaceId = clean(candidate.googlePlaceId);
      if (!externalPlaceId) {
        throw new Phase9ItineraryBridgeError(
          `${candidate.name} is missing its verified Google Place identity.`,
          candidate.name,
        );
      }
      if (seenExternalPlaceIds.has(externalPlaceId)) {
        throw new Phase9ItineraryBridgeError(
          `${candidate.name} shares a Google Place identity with another scheduled place.`,
          candidate.name,
        );
      }
      seenExternalPlaceIds.add(externalPlaceId);
      if (!validLatitude(candidate.latitude)) {
        throw new Phase9ItineraryBridgeError(
          `${candidate.name} is missing a valid latitude.`,
          candidate.name,
        );
      }
      if (!validLongitude(candidate.longitude)) {
        throw new Phase9ItineraryBridgeError(
          `${candidate.name} is missing a valid longitude.`,
          candidate.name,
        );
      }
      if (
        !Number.isInteger(scheduled.durationMinutes) ||
        scheduled.durationMinutes < 15 ||
        scheduled.durationMinutes > 720
      ) {
        throw new Phase9ItineraryBridgeError(
          `${candidate.name} has an invalid visit duration.`,
          candidate.name,
        );
      }
      if (!TIME_PATTERN.test(scheduled.startTime)) {
        throw new Phase9ItineraryBridgeError(
          `${candidate.name} has an invalid scheduled time.`,
          candidate.name,
        );
      }

      const types = Array.from(
        new Set(
          [candidate.category, ...candidate.subcategories]
            .map(clean)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      placesByGoogleId.set(externalPlaceId, {
        externalPlaceId,
        name: candidate.name,
        address: null,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        rating: candidate.googleRating,
        ratingCount: candidate.googleRatingCount,
        priceLevel: candidate.priceLevel,
        types,
      });
      items.push({
        externalPlaceId,
        day: day.day,
        sortOrder,
        plannedTime: scheduled.startTime,
        estimatedDurationMinutes: scheduled.durationMinutes,
        estimatedCost: null,
        reason: conciseReason(candidate, scheduled.schedulingReasons),
        dayTheme: dayTheme(grouping, day.day, destination),
      });
    }
  }

  if (items.length !== schedule.scheduledPlaceCount) {
    throw new Phase9ItineraryBridgeError(
      'The schedule count changed while preparing the map plan.',
    );
  }

  return {
    places: [...placesByGoogleId.values()],
    items,
    canonicalSignature: hash(canonicalRows(items)),
  };
}

export function persistedItinerarySignature(itinerary: ItineraryView | null) {
  if (!itinerary) return null;
  const items = itinerary.days.flatMap((day) =>
    day.items.map((item) => ({
      externalPlaceId: item.place.externalPlaceId,
      day: item.day,
      sortOrder: item.sortOrder,
      plannedTime: item.plannedTime,
      estimatedDurationMinutes: item.estimatedDurationMinutes,
    })),
  );
  return items.length ? hash(canonicalRows(items)) : null;
}

export function phase9ItineraryMatchesPersisted(
  desired: Phase9ItineraryBridgePayload,
  itinerary: ItineraryView | null,
) {
  return desired.canonicalSignature === persistedItinerarySignature(itinerary);
}
