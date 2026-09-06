export type PlaceSelectionMember = {
  userId: string;
  displayName: string;
  completed: boolean;
};

export function selectionCompletionSummary(
  members: PlaceSelectionMember[],
  currentUserId: string,
) {
  const completedMembers = members.filter((member) => member.completed).length;
  return {
    completedMembers,
    planningMembers: members.length,
    allCompleted: members.length > 0 && completedMembers === members.length,
    currentUserCompleted:
      members.find((member) => member.userId === currentUserId)?.completed ??
      false,
  };
}
