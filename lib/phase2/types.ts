export type PlanningContext = {
  destination: string;
  durationDays: number;
  finiteBudgetAverage: number | null;
  unlimitedMembers: number;
  averagePace: number;
  topInterests: { key: string; label: string; rating: number }[];
};

export type DestinationSuggestion = {
  destination: string;
  reason: string;
  inputWasSpecific: boolean;
};

export type SearchRequest = {
  query: string;
  category: string;
  desiredCount: number;
};

export type SearchStrategy = {
  searches: SearchRequest[];
};

export type PlaceCandidate = {
  externalPlaceId: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  ratingCount: number | null;
  priceLevel: string | null;
  types: string[];
};

export type SelectedItineraryItem = {
  externalPlaceId: string;
  estimatedDurationMinutes: number;
  estimatedCost: number | null;
  reason: string;
};

export type SelectedItineraryDay = {
  day: number;
  theme: string;
  items: SelectedItineraryItem[];
};

export type SelectedItinerary = {
  days: SelectedItineraryDay[];
};

export type PersistedItineraryItem = SelectedItineraryItem & {
  day: number;
  sortOrder: number;
  plannedTime: string;
  dayTheme: string;
};

export type ItineraryPlace = Omit<PlaceCandidate, 'latitude' | 'longitude'> & {
  latitude: number | null;
  longitude: number | null;
};

export type ItineraryItemView = {
  id: string;
  day: number;
  sortOrder: number;
  plannedTime: string;
  estimatedDurationMinutes: number;
  estimatedCost: number | null;
  reason: string;
  dayTheme: string;
  place: ItineraryPlace;
};

export type ItineraryView = {
  destination: string;
  durationDays: number;
  days: { day: number; theme: string; items: ItineraryItemView[] }[];
};

export type ItineraryPageData = {
  trip: {
    id: string;
    destination: string | null;
    destinationInput: string | null;
    durationDays: number;
  };
  itinerary: ItineraryView | null;
};
