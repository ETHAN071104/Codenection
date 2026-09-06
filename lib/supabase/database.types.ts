export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type TripRow = {
  id: string;
  room_code: string;
  created_by: string;
  destination: string | null;
  destination_input: string | null;
  exploration_preference: string;
  geographic_scope: Json | null;
  arrival_time: string | null;
  departure_time: string | null;
  arrival_point: Json | null;
  departure_point: Json | null;
  finalized_at: string | null;
  finalized_by: string | null;
  planning_mode: string | null;
  setup_stage: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  created_at: string;
  updated_at: string;
};

type TripInsert = {
  id?: string;
  room_code: string;
  created_by: string;
  destination?: string | null;
  destination_input?: string | null;
  exploration_preference?: string;
  geographic_scope?: Json | null;
  arrival_time?: string | null;
  departure_time?: string | null;
  arrival_point?: Json | null;
  departure_point?: Json | null;
  finalized_at?: string | null;
  finalized_by?: string | null;
  planning_mode?: string | null;
  setup_stage?: string;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  created_at?: string;
  updated_at?: string;
};

type TripMemberRow = {
  id: string;
  trip_id: string;
  user_id: string;
  display_name: string;
  joined_at: string;
};

type PreferenceRow = {
  id: string;
  trip_id: string;
  user_id: string;
  personal_budget: number | null;
  budget_unlimited: boolean;
  travel_pace: number | null;
  interests: Json;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type PlaceRow = {
  id: string;
  trip_id: string;
  external_place_id: string | null;
  name: string;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  rating_count: number | null;
  price_level: string | null;
  types: string[];
  estimated_duration_minutes: number | null;
  estimated_cost: number | null;
  metadata: Json;
  created_at: string;
};

type ItineraryItemRow = {
  id: string;
  trip_id: string;
  place_id: string | null;
  day_number: number | null;
  sort_order: number;
  planned_start: string | null;
  planned_end: string | null;
  estimated_cost: number | null;
  estimated_duration_minutes: number | null;
  reason: string | null;
  day_theme: string | null;
  planned_time: string | null;
  generation_source: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type MalaysiaPlaceRow = {
  id: string;
  google_place_id: string | null;
  name: string;
  country: string;
  state: string | null;
  city: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  subcategories: string[];
  estimated_duration_minutes: number | null;
  indoor_outdoor: string | null;
  best_time_of_day: string | null;
  culture_score: number | null;
  food_score: number | null;
  nature_score: number | null;
  shopping_score: number | null;
  adventure_score: number | null;
  nightlife_score: number | null;
  photography_score: number | null;
  budget_score: number | null;
  google_rating: number | null;
  google_rating_count: number | null;
  price_level: string | null;
  source: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TripPlaceVoteRow = {
  id: string;
  trip_id: string;
  place_id: string;
  user_id: string;
  selected: boolean;
  created_at: string;
  updated_at: string;
};

export type TripPlaceSelectionMemberRow = {
  trip_id: string;
  user_id: string;
  completed_at: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      trips: Table<TripRow, TripInsert, Partial<TripInsert>>;
      trip_members: Table<
        TripMemberRow,
        {
          id?: string;
          trip_id: string;
          user_id: string;
          display_name: string;
          joined_at?: string;
        },
        { display_name?: string }
      >;
      preference_profiles: Table<
        PreferenceRow,
        {
          id?: string;
          trip_id: string;
          user_id: string;
          personal_budget?: number | null;
          budget_unlimited?: boolean;
          travel_pace?: number | null;
          interests?: Json;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        Partial<PreferenceRow>
      >;
      places: Table<
        PlaceRow,
        {
          id?: string;
          trip_id: string;
          external_place_id?: string | null;
          name: string;
          formatted_address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          rating?: number | null;
          rating_count?: number | null;
          price_level?: string | null;
          types?: string[];
          estimated_duration_minutes?: number | null;
          estimated_cost?: number | null;
          metadata?: Json;
          created_at?: string;
        },
        Partial<PlaceRow>
      >;
      itinerary_items: Table<
        ItineraryItemRow,
        {
          id?: string;
          trip_id: string;
          place_id?: string | null;
          day_number?: number | null;
          sort_order: number;
          planned_start?: string | null;
          planned_end?: string | null;
          estimated_cost?: number | null;
          estimated_duration_minutes?: number | null;
          reason?: string | null;
          day_theme?: string | null;
          planned_time?: string | null;
          generation_source?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<ItineraryItemRow>
      >;
      malaysia_places: Table<
        MalaysiaPlaceRow,
        Omit<MalaysiaPlaceRow, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        },
        Partial<MalaysiaPlaceRow>
      >;
      trip_place_votes: Table<
        TripPlaceVoteRow,
        {
          id?: string;
          trip_id: string;
          place_id: string;
          user_id: string;
          selected?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        { selected?: boolean; updated_at?: string }
      >;
      trip_place_selection_members: Table<
        TripPlaceSelectionMemberRow,
        {
          trip_id: string;
          user_id: string;
          completed_at?: string | null;
          created_at?: string;
        },
        { completed_at?: string | null }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      create_trip: {
        Args: {
          p_display_name: string;
          p_destination?: string | null;
          p_start_date?: string | null;
          p_end_date?: string | null;
          p_duration_days?: number | null;
        };
        Returns: { trip_id: string; room_code: string }[];
      };
      join_trip_by_code: {
        Args: { p_room_code: string; p_display_name: string };
        Returns: { trip_id: string; room_code: string }[];
      };
      save_preference_profile: {
        Args: {
          p_trip_id: string;
          p_personal_budget: number | null;
          p_budget_unlimited: boolean;
          p_travel_pace: number;
          p_interests: Json;
        };
        Returns: { completed_at: string }[];
      };
      get_questionnaire_status: {
        Args: { p_trip_id: string };
        Returns: {
          member_id: string;
          display_name: string;
          completed: boolean;
          total_members: number;
          completed_members: number;
          all_completed: boolean;
        }[];
      };
      get_group_preference_summary: {
        Args: { p_trip_id: string };
        Returns: {
          finite_budget_average: number | null;
          unlimited_members: number;
          average_pace: number;
          average_interests: Json;
        }[];
      };
      replace_generated_itinerary: {
        Args: {
          p_trip_id: string;
          p_destination: string;
          p_places: Json;
          p_items: Json;
        };
        Returns: { saved_items: number }[];
      };
      reorder_itinerary_day: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_item_ids: string[];
        };
        Returns: { item_id: string; sort_order: number }[];
      };
      adjust_itinerary_schedule: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_current_item_id: string;
          p_change_type: string;
          p_minutes: number;
        };
        Returns: { item_id: string; planned_time: string }[];
      };
      reschedule_itinerary_day: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_schedule: Json;
        };
        Returns: { item_id: string; planned_time: string }[];
      };
      add_itinerary_place: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_place: Json;
          p_estimated_duration_minutes?: number;
        };
        Returns: { item_id: string }[];
      };
      remove_itinerary_item: {
        Args: { p_trip_id: string; p_item_id: string };
        Returns: { day_number: number }[];
      };
      replace_itinerary_day: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_items: Json;
          p_places: Json;
        };
        Returns: { saved_items: number }[];
      };
      start_place_selection_round: {
        Args: { p_trip_id: string };
        Returns: { planning_members: number }[];
      };
      set_place_selection_completion: {
        Args: { p_trip_id: string; p_completed: boolean };
        Returns: {
          completed_members: number;
          planning_members: number;
          all_completed: boolean;
        }[];
      };
      finalize_trip: {
        Args: { p_trip_id: string };
        Returns: { finalized_at: string; already_finalized: boolean }[];
      };
      apply_ai_itinerary_day: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_items: Json;
          p_places: Json;
        };
        Returns: { saved_items: number }[];
      };
      reschedule_post_planning_itinerary_day: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_schedule: Json;
        };
        Returns: { item_id: string; planned_time: string }[];
      };
      apply_live_schedule_adjustment: {
        Args: {
          p_trip_id: string;
          p_day_number: number;
          p_current_item_id: string;
          p_change_type: string;
          p_minutes: number;
        };
        Returns: { item_id: string; planned_time: string }[];
      };
      remove_live_itinerary_item: {
        Args: { p_trip_id: string; p_item_id: string };
        Returns: { day_number: number }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
