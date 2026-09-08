import type { CandidatePlace } from './types';

export const PACE_SHORTLIST_RANGES = {
  1: { minimum: 6, maximum: 8 },
  2: { minimum: 7, maximum: 9 },
  3: { minimum: 8, maximum: 12 },
  4: { minimum: 10, maximum: 14 },
  5: { minimum: 12, maximum: 16 },
} as const;

const MINIMUM_RECOMMENDATION_SCORE = 45;
const MAXIMUM_SCORE_DROP = 25;

function paceLevel(averagePace: number | null | undefined) {
  return Math.min(5, Math.max(1, Math.round(averagePace ?? 3))) as
    | 1
    | 2
    | 3
    | 4
    | 5;
}

export function suggestedShortlistSize(
  averagePace: number | null | undefined,
  durationDays: number | null | undefined,
) {
  const range = PACE_SHORTLIST_RANGES[paceLevel(averagePace)];
  const durationFactor = Math.min(
    0.85,
    Math.max(0, ((durationDays ?? 3) - 1) / 6),
  );
  return Math.min(
    range.maximum,
    range.minimum +
      Math.round((range.maximum - range.minimum) * durationFactor),
  );
}

export function createSuggestedShortlist(
  candidates: CandidatePlace[],
  options: {
    averagePace: number | null | undefined;
    durationDays: number | null | undefined;
  },
) {
  const ranked = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      (b.googleRating ?? -1) - (a.googleRating ?? -1) ||
      (b.googleRatingCount ?? -1) - (a.googleRatingCount ?? -1) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  const bestScore = ranked[0]?.score ?? 0;
  const qualityFloor = Math.max(
    MINIMUM_RECOMMENDATION_SCORE,
    bestScore - MAXIMUM_SCORE_DROP,
  );
  return ranked
    .filter((candidate) => candidate.score >= qualityFloor)
    .slice(
      0,
      suggestedShortlistSize(options.averagePace, options.durationDays),
    );
}
