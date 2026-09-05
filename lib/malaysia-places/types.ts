import type { GroupPreferenceSummary } from '@/lib/preferences/model';

export type MalaysiaPlace = {
  id: string;
  googlePlaceId: string | null;
  name: string;
  country: string;
  state: string | null;
  city: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  subcategories: string[];
  estimatedDurationMinutes: number | null;
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed' | null;
  bestTimeOfDay: string | null;
  cultureScore: number | null;
  foodScore: number | null;
  natureScore: number | null;
  shoppingScore: number | null;
  adventureScore: number | null;
  nightlifeScore: number | null;
  photographyScore: number | null;
  budgetScore: number | null;
  googleRating: number | null;
  googleRatingCount: number | null;
  priceLevel: string | null;
  source: string;
  lastVerifiedAt: string | null;
};

export type CandidatePlace = MalaysiaPlace & { score: number; reasons: string[] };
export type CandidateQuery = {
  city: string;
  travelDna: GroupPreferenceSummary;
  area?: string;
  limit?: number;
};
