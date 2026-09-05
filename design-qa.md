# Stay Area and Schedule design QA

- Source visual truth: [Figma Make — Collaborative Travel Planner Redesign](https://www.figma.com/make/AhObgInhTZHTAaM2RPKlO1/Collaborative-Travel-Planner-Redesign?t=yGQV1KwCJ9OrTCn1-1), `Stay Area` and `Schedule` states.
- Implementation screenshot path: Codex in-app Browser captures of `http://localhost:3000/trip/088b5d20-27ce-4e3d-a0b3-fe36fef7cadb/places` in the Stay Area and Schedule staged states (transient browser captures; the verified local URL is the reproducible source).
- Viewport: desktop `1114 × 958` CSS px at DPR 1; responsive check `390 × 844` CSS px.
- Pixel dimensions and normalization: Figma prototype and implementation desktop captures were both `1114 × 958` px. The mobile implementation capture used a `390 × 844` CSS viewport. Comparisons used the direct Figma prototype rather than editor chrome or the laptop frame; no density resampling was required for desktop.
- State: live Kuala Lumpur trip, four real trip days, six current group-selected places, real `Imbi` Stay Area recommendation, real `Bukit Bintang` alternative, and the existing deterministic schedule output.

## Full-view comparison evidence

The Figma and rendered Stay Area captures were emitted together in one comparison input. The same was done for Schedule, followed by a post-fix Schedule comparison. Both implemented states preserve the Figma hierarchy: warm parchment field, compact progress rail, editorial serif headline, white evidence/timeline surfaces, warm accent, thin borders, restrained shadow, clear day controls, quiet transitions, and one dominant next action.

The implementation intentionally omits Figma's demo qualities, dates, travel modes, walking/transit claims, and area descriptions because those fields do not exist in the real Phase 9 output. Real Kuala Lumpur areas, selected counts, calculated spread, trip duration, item times, durations, transitions, break data, and explainability are used instead.

## Focused region comparison evidence

The direct full-view captures kept headings, evidence rows, tabs, day header, timeline rows, time columns, durations, transition rows, and explanation copy legible. Separate `390 × 844` captures verified headline wrapping, horizontal day-tab usability, timeline column containment, card padding, and vertical scrolling without horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: Lora carries the editorial headlines and day titles; the established UI face handles labels, controls, metadata, and timeline content. Long Kuala Lumpur headings wrap cleanly on mobile and retain the source hierarchy.
- Spacing and layout rhythm: both stages use focused content widths, generous top/section spacing, moderate radii, fine dividers, and restrained elevation. Schedule is intentionally wider than Stay Area while remaining a single reading column.
- Colors and visual tokens: all primary surfaces use the established parchment, paper, ink, warm-muted, brown-accent, warm-border, and editorial-shadow tokens. The day header uses the source's restrained warm highlight.
- Image quality and asset fidelity: the Figma states are typography-first and require no photography. Interface icons use the existing Lucide family; no custom SVG, emoji, CSS art, or fabricated imagery is used.
- Copy and content: technical algorithm labels are removed from the traveler-facing screens. Copy is derived only from real output fields, and unsupported Figma demo claims are omitted.

## Findings

No actionable P0, P1, or P2 mismatches remain.

- [P3] The real Schedule uses a wider reading measure and larger headline than the compact Figma demo. This is acceptable for the existing desktop shell and improves scanning of live Kuala Lumpur place names.
- [P3] The Schedule CTA is visibly disabled rather than navigating onward. This is an intentional architecture safeguard because the Phase 9 schedule is not yet persisted into `itinerary_items` for Map Planner.

## Comparison history

1. Initial comparison found a P2 long-page layout issue: the shared shell vertically centered Schedule, allowing tall content to extend above the accessible page top.
2. `JourneyShell` received an opt-in start alignment used only by the two new planning stages. Post-fix captures show the complete shell header and Schedule heading at the top.
3. Stage testing found a P2 transition issue: activating Schedule from a CTA near the bottom could retain the prior scroll offset.
4. A delayed scroll reset was added for staged view changes. The post-fix Figma/implementation comparison shows Schedule opening at its header with the global journey rail intact.
5. Mobile captures at `390 × 844` show usable day tabs, readable timeline columns, and no horizontal overflow. The Next.js error alert remained empty during the tested flow.

## Implementation checklist

- [x] Real Stay Area recommendation and optional real alternative
- [x] Humanized calculation-backed Stay Area evidence
- [x] No hotel, booking, invented travel, or new persistence behavior
- [x] Existing deterministic days, places, times, durations, and ordering
- [x] Transition buffers shown as quiet travel rows
- [x] Meal breaks preserved and visually distinct
- [x] Overflow preserved as `Optional — if you have time`
- [x] Calculation-backed explainability translated into travel language
- [x] Responsive day tabs and timeline
- [x] Map handoff safely disabled until the itinerary bridge exists
- [x] Candidate Places Realtime subscription remains active
- [x] TypeScript, lint, and production build pass

## Follow-up polish

- P3 only: enable the prepared map CTA once a later phase persists the Phase 9 schedule into the existing itinerary model.

final result: passed
