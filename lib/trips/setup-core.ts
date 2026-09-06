export type TripPlanningMode = 'collaborative' | 'ai';

export type TripSetupStage =
  | 'destination'
  | 'scope'
  | 'mode'
  | 'preparing'
  | 'collaborative_ready'
  | 'ai_ready';

export function parseTripPlanningMode(
  value: unknown,
): TripPlanningMode | null {
  return value === 'collaborative' || value === 'ai' ? value : null;
}

export function parseTripSetupStage(value: unknown): TripSetupStage {
  return value === 'destination' ||
    value === 'scope' ||
    value === 'mode' ||
    value === 'preparing' ||
    value === 'collaborative_ready' ||
    value === 'ai_ready'
    ? value
    : 'destination';
}

export function canControlTripSetup(createdBy: string, userId: string) {
  return Boolean(createdBy) && createdBy === userId;
}

export function hasConfirmedScope(stage: TripSetupStage) {
  return (
    stage === 'mode' ||
    stage === 'preparing' ||
    stage === 'collaborative_ready' ||
    stage === 'ai_ready'
  );
}
