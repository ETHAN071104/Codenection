import {
  compareConsensusPriority,
  consensusPriorityTier,
  type ConsensusPlace,
} from './consensus-core';

export type SelectionPriority =
  | { source: 'consensus' }
  | { source: 'recommendation'; rank: number };

export type SelectionPriorityPlace = ConsensusPlace & {
  selectionPriority?: SelectionPriority;
};

export function consensusSelectionPriority(): SelectionPriority {
  return { source: 'consensus' };
}

export function recommendationSelectionPriority(
  rank: number,
): SelectionPriority {
  return { source: 'recommendation', rank: Math.max(0, Math.floor(rank)) };
}

export function isRecommendationPriority(place: SelectionPriorityPlace) {
  return place.selectionPriority?.source === 'recommendation';
}

export function selectionPriorityTier(place: SelectionPriorityPlace) {
  return place.selectionPriority?.source === 'recommendation'
    ? place.selectionPriority.rank
    : consensusPriorityTier(place.voteCount, place.totalMembers);
}

export function compareSelectionPriority<Place extends SelectionPriorityPlace>(
  a: Place,
  b: Place,
) {
  const aAutomatic = a.selectionPriority?.source === 'recommendation';
  const bAutomatic = b.selectionPriority?.source === 'recommendation';
  if (aAutomatic && bAutomatic) {
    return (
      selectionPriorityTier(a) - selectionPriorityTier(b) ||
      b.score - a.score ||
      b.groupScore - a.groupScore ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  }
  if (!aAutomatic && !bAutomatic) return compareConsensusPriority(a, b);
  return aAutomatic ? 1 : -1;
}
