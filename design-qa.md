# Map Plan visual correction QA

**Source visual truth**

- `C:\Users\Asus\AppData\Local\Temp\codex-clipboard-9a63a886-ebf6-4a4f-bea3-91789e6a7656.png`
- Focused itinerary reference: `C:\Users\Asus\AppData\Local\Temp\codex-clipboard-f69afb89-87ee-4555-bd77-605f8d92a1d2.png`
- Source pixels: 1680 × 945, normalized to 1366 × 768 at density 1.

**Rendered implementation**

- `C:\Users\Asus\Documents\ChatGPT\Codenection\map-plan-correction-1366x768.png`
- Implementation pixels and CSS viewport: 1366 × 768 at density 1.
- Combined comparison: `C:\Users\Asus\Documents\ChatGPT\Codenection\map-plan-correction-comparison.png`
- State: deterministic Kuala Lumpur Day 1 fixture with three stops, route, weather, and existing Place Photo proxy paths.

**Full-view comparison evidence**

- The map occupies exactly 1366 × 768 with no page-level overflow. The floating panel is 437 × 660 at x=909, y=88, and the persistent Start Live Trip action is visible.
- Water is distinctly blue-cyan, parks are visibly sage green, urban fills remain warm and quiet, and the copper route retains clear contrast over the basemap.
- The map remains visible beneath the 78% warm cream panel and 70% top bar; both surfaces use real backdrop blur, rounded edges, white highlights, and restrained shadows.

**Focused region comparison evidence**

- Typography: the existing editorial serif hierarchy for destination and stop names matches the target, while compact sans-serif metadata remains readable.
- Spacing and layout: the itinerary uses continuous dividers and a dotted timeline rather than individual cards. At 1366 × 768 the third stop continues inside the intended internal scroll region while header and CTA stay fixed.
- Colors: cyan waterways, fresh sage parks, warm off-white land, muted road hierarchy, copper route, brown markers, cream glass, and charcoal CTA align with the target palette.
- Image quality: all three stop rows rendered real raster thumbnails through the existing same-origin Place Photo path; no CSS or placeholder illustration substitutes were used.
- Copy: destination, day, stop, duration, rating, weather, and travel metadata remain data-driven.

**Findings**

- No actionable P0, P1, or P2 visual differences remain.
- P3: the implementation retains slightly more vertical breathing room than the target, so the final stop may require a short internal scroll at 1366 × 768; this is consistent with the requested scrolling model.

**Comparison history**

- The correction pass addressed the prior beige map, insufficient water/park separation, opaque panel treatment, and missing itinerary thumbnails.
- The post-fix combined comparison confirms the richer basemap, true translucent glass, refined timeline, and three thumbnail surfaces.

**Primary interactions and console check**

- Existing day switching, Ask AI, item selection, Full itinerary, and Start Live Trip handlers were preserved without logic changes.
- The deterministic fixture produced two expected 400 responses from realtime/session requests that require a production UUID; the rendered Map Plan UI, map tiles, route, weather, and photos completed successfully.

final result: passed
