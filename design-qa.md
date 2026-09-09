# Live Trip cinematic UI design QA

**Source visual truth**

- `C:\Users\Asus\AppData\Local\Temp\codex-clipboard-642fa98f-ae0e-46fd-9b1f-a43670e606ad.png`
- Source pixels: 1680 × 945, normalized to 1366 × 768 at density 1 for comparison.

**Rendered implementation**

- `C:\Users\Asus\Documents\ChatGPT\Codenection\live-trip-cinematic-1366x768.png`
- Implementation pixels and CSS viewport: 1366 × 768 at density 1.
- Combined comparison: `C:\Users\Asus\Documents\ChatGPT\Codenection\live-trip-design-comparison.png`
- State: day background slot unavailable, neutral fallback active, current place photo unavailable, live route and partly cloudy weather loaded from deterministic test fixtures.

**Full-view comparison evidence**

- The implementation preserves the reference composition: compact floating status bar, dominant cream current-activity card, upper-right dark route map, lower-right context card, and one centered change button.
- Grid proportions, panel radius, editorial hierarchy, dark/cream contrast, and 1366 × 768 viewport fit are materially aligned. The document measured exactly 1366 × 768 with no overflow; the map measured 492 × 416 and the persistent change button remained visible.
- Missing cinematic video and current-place imagery are expected asset/data fallbacks rather than layout substitutions. The interface reserves both image surfaces without fabricating media.

**Focused region comparison evidence**

- Typography: the existing Lora editorial face and Geist supporting face preserve the source's serif/sans hierarchy, with similar title scale and compact metadata.
- Spacing and layout: the main card spans both rows; map and weather cards align to its right edge; the change action is isolated below the composition.
- Colors: cream panels, near-black live chrome, warm brown metadata, and restrained live-route contrast match the reference direction.
- Image quality: the reference imagery is intentionally replaced only by the specified neutral fallback because production video files and a fixture Google photo were unavailable. Runtime code uses the existing Google Places photo proxy when live metadata exists.
- Copy: all visible place, time, weather, route, cost, day, and location content is data-driven rather than copied from the Tokyo reference.

**Findings**

- No actionable P0, P1, or P2 visual differences remain.
- P3: the final atmosphere depends on the three pending production MP4 files and live Google photo availability.

**Comparison history**

- Initial comparison passed without a correction cycle. No P0, P1, or P2 fixes were required after capture.

**Implementation checklist**

- Preserve the existing change dialog, route, weather, realtime, cost, and itinerary logic.
- Drop final assets into `public/videos/live/day.mp4`, `night.mp4`, and `rain.mp4`.
- Verify one production itinerary with a cached Google Places photo after assets are supplied.

final result: passed
