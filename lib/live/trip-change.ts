export type TripChangeEvent =
  | { type: 'stay_longer'; minutes: number }
  | { type: 'running_late'; minutes: number }
  | { type: 'lost_item'; note: string }
  | { type: 'separated'; memberId?: string }
  | { type: 'weather_problem' }
  | { type: 'emergency'; note?: string };

export type TripChangeType = TripChangeEvent['type'];

export type LiveTripMember = {
  id: string;
  displayName: string;
};
