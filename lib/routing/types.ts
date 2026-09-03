export type RouteGeometry = {
  type: 'LineString';
  coordinates: [number, number][];
};

export type RouteSegment = {
  fromItemId: string;
  toItemId: string;
  distanceMeters: number;
  durationSeconds: number;
};

export type TripRoute = {
  geometry: RouteGeometry | null;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  segments: RouteSegment[];
};
