export type TripLifecycleAccess = {
  isMember: boolean;
  isHost: boolean;
  isFinalized: boolean;
  isLateJoiner: boolean;
};

export type TripMutationKind = 'planning' | 'ai_edit' | 'live_change';

export function deriveTripLifecycleAccess(input: {
  userId: string;
  createdBy: string;
  joinedAt: string | null;
  finalizedAt: string | null;
}): TripLifecycleAccess {
  const isMember = input.joinedAt !== null;
  const isFinalized = input.finalizedAt !== null;
  return {
    isMember,
    isHost: isMember && input.userId === input.createdBy,
    isFinalized,
    isLateJoiner:
      isMember &&
      isFinalized &&
      new Date(input.joinedAt!).getTime() >
        new Date(input.finalizedAt!).getTime(),
  };
}

export function canFinalizeTrip(
  access: TripLifecycleAccess,
  hasPersistedItinerary: boolean,
) {
  return access.isHost && hasPersistedItinerary;
}

export function canApplyTripMutation(
  access: TripLifecycleAccess,
  kind: TripMutationKind,
) {
  if (!access.isMember) return false;
  return kind !== 'planning' || !access.isFinalized;
}
