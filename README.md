# Collaborative Travel Planner

## Phase 0

Phase 0 provides the technical foundation for a no-login collaborative travel
planner:

- Next.js App Router, React, TypeScript, and Tailwind CSS
- persistent Supabase anonymous sessions (`auth.uid()` is the identity)
- display-name entry without email, password, OAuth, or account forms
- secure six-digit room creation and join flows through database RPCs
- a private trip page with the room code and member list
- initial tables and row-level security for trips, members, preferences, places,
  and itinerary items

Questionnaires, AI, maps, routes, realtime editing, weather, and other later-phase
features are intentionally not implemented.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create and configure Supabase

Create a Supabase project. In the Supabase dashboard, enable **Anonymous Sign-Ins**
under Authentication settings.

Run [`supabase/migrations/20260903000000_phase_0_foundation.sql`](supabase/migrations/20260903000000_phase_0_foundation.sql)
with the Supabase CLI or SQL editor. The migration creates all Phase 0 tables,
constraints, indexes, RLS policies, and the `create_trip` and
`join_trip_by_code` RPC functions.

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and add the project URL and publishable key:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

The publishable key is safe to use in the browser because authorization is
enforced by RLS. Never put the Supabase service-role key in a browser environment
variable. The OpenRouter, Google Places, and OpenRouteService placeholders are
server-only and must not receive `NEXT_PUBLIC_` prefixes.

### 4. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Manual verification

Use two isolated browser sessions so Supabase creates two distinct anonymous
identities:

1. In Browser A, enter `Ethan`, create a trip, and note the six-digit room code.
2. In Browser B or an incognito window, enter `Alex` and join with that code.
3. Refresh Browser A's trip page or use its Refresh button.
4. Confirm both pages show Ethan and Alex.
5. In Supabase, confirm one `trips` row and two `trip_members` rows with the same
   `trip_id` and different `user_id` values.
6. Try an invalid room code and confirm that a friendly error is shown.
7. From a third anonymous session, try querying the trip by UUID without joining;
   RLS should return no trip.

## Security model

Anonymous visitors receive normal Supabase authenticated sessions, so RLS can use
`auth.uid()`. Direct trip insertion and member insertion are not granted to the
browser. Narrow `SECURITY DEFINER` RPCs perform the bootstrap operations with a
fixed empty `search_path`, explicit identity and input checks, and narrow return
values. Normal table reads and future writes remain member-scoped through RLS.

The six-digit code is intentionally a shareable capability for this MVP. Add
rate-limiting or abuse controls around room-code joins before a public production
launch if threat levels require it. Supabase also recommends CAPTCHA or Turnstile
for public anonymous-sign-in flows to limit automated anonymous-user creation.

## Future service boundaries

Future integrations should remain server-side and can be added under focused
modules such as `lib/ai`, `lib/places`, `lib/routing`, and `lib/weather`. The map
layer can later use mapcn with MapLibre without making CARTO a required provider.

## Next Phase

Phase 1 is the **Simple Questionnaire**:

- Personal Budget
- Travel Pace
- Interest ratings from 1–5

Phase 1 is not part of this implementation.
