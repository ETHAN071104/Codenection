export type ConsensusPlace = {
  id: string;
  name: string;
  voteCount: number;
  totalMembers: number;
  groupScore: number;
  score: number;
};

export function consensusPriorityTier(
  votes: number,
  planningMembers: number,
) {
  if (planningMembers > 0 && votes >= planningMembers) return 0;
  if (planningMembers > 0 && votes * 2 > planningMembers) return 1;
  return 2;
}

export function compareConsensusPriority<Place extends ConsensusPlace>(
  a: Place,
  b: Place,
) {
  const tierOrder =
    consensusPriorityTier(a.voteCount, a.totalMembers) -
    consensusPriorityTier(b.voteCount, b.totalMembers);
  if (tierOrder) return tierOrder;

  const aShare = a.totalMembers > 0 ? a.voteCount / a.totalMembers : 0;
  const bShare = b.totalMembers > 0 ? b.voteCount / b.totalMembers : 0;
  return (
    bShare - aShare ||
    b.voteCount - a.voteCount ||
    b.groupScore - a.groupScore ||
    b.score - a.score ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

export function consensusTiers<Place extends ConsensusPlace>(
  places: Place[],
  planningMembers: number,
) {
  const selected = places
    .filter((place) => place.voteCount > 0)
    .sort(compareConsensusPriority);
  return {
    unanimous:
      planningMembers > 0
        ? selected.filter((place) => place.voteCount >= planningMembers)
        : [],
    additional: selected.filter(
      (place) => planningMembers <= 0 || place.voteCount < planningMembers,
    ),
  };
}
