import type { CandidatePlace } from './types';

export type RankedCandidate = CandidatePlace & {
  voteCount: number;
  totalMembers: number;
  currentUserSelected: boolean;
  groupScore: number;
};

export function groupScore(recommendationScore: number, votes: number, members: number) {
  const interest = members > 0 ? votes / members : 0;
  return Math.round(Math.min(100, recommendationScore * 0.75 + interest * 25));
}

export function rankCandidates(candidates: RankedCandidate[]) {
  return [...candidates].sort(
    (a, b) =>
      b.voteCount - a.voteCount ||
      b.groupScore - a.groupScore ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
