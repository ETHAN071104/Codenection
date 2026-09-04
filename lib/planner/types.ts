import type { ItineraryPageData, PlaceCandidate } from '@/lib/phase2/types';
import type { TripRoute } from '@/lib/routing/types';

export type PlannerMutationResponse = {
  data: ItineraryPageData;
  day: number;
  route: TripRoute;
};

export type PlaceSearchResponse = {
  results: PlaceCandidate[];
};

export type AiEditOperation = {
  id: string;
  type: 'remove' | 'move' | 'add' | 'replace';
  day: number;
  itemId: string | null;
  targetIndex: number | null;
  summary: string;
  expectedEffect: string;
  place: PlaceCandidate | null;
};

export type AiEditProposal = {
  request: string;
  overview: string;
  operations: AiEditOperation[];
};

export type WeatherAtStop = {
  itemId: string;
  plannedTime: string;
  temperatureC: number | null;
  precipitationProbability: number | null;
  weatherCode: number | null;
  condition: string;
};

export type WeatherDayResponse = {
  day: number;
  date: string;
  stops: WeatherAtStop[];
};
