# KAPUTT concept 3 implementation QA

final result: passed

## Comparison target and evidence

- Source visual truth: third displayed concept, original image `generated_images/exec-f3640e69-3f01-44d7-b763-873a23c744d1.png` in the implementation workspace. Original pixels: 853 × 1844. Normalized to 390 × 844 for comparison.
- Browser-rendered implementation: [mobile-390.jpg](docs/qa/mobile-390.jpg), 390 × 844 pixels, CSS viewport 390 × 844, screenshot scale 1 pixel per CSS pixel. Browser chrome and preview surround are excluded.
- Full-view comparison: [concept-3-comparison.jpg](docs/qa/concept-3-comparison.jpg), source left, implementation right.
- Focused dice/material comparison: [dice-comparison.jpg](docs/qa/dice-comparison.jpg), source left, implementation right.
- Compact layout: [compact-320.jpg](docs/qa/compact-320.jpg), 320 × 568. DOM dimensions confirm no horizontal or vertical overflow at this size.
- Matched state: target 12, opponent 58 with 1 Kaputt, current player 42 with 2 Kaputts, left die 4 revealed, right concealed, decision buttons visible. The visual fixture exists only in the development server; the deployed game starts with a real, empty match.
- Local reproduction: `npm ci && npm run build && npm run dev`; `/__preview?visual&width=390&height=844` for the comparison. Use `/` for actual play.

## Findings and comparison history

All actionable P0/P1/P2 findings from the comparison iterations were addressed.

1. **P1, dice unavailable in GPU-disabled browsers.** The initial browser capture used the flat accessibility fallback. Added a Canvas2D renderer that projects the same Three.js meshes, retaining real rotation and reveal motion. Later captures show both volumetric dice.
2. **P1, broken pip silhouettes and far-side rim artifacts.** Early software-rendered captures showed partial pips and extra rings. Corrected detail draw order and face culling. The final focused comparison shows complete, correctly placed pips without far-side artifacts.
3. **P2, typography and copy drift.** Replaced the narrow initial font with self-hosted Barlow weights, adjusted the logo, score and action sizing, and restored the concept's attack explanation. The final full-view comparison confirms the original hierarchy and copy.
4. **P2, compact dice clipping.** The 320 × 568 capture initially cut the lower dice edges. Adapted the camera frustum to short canvases. The final compact screenshot shows the complete dice and both actions.

## Required fidelity surfaces

- **Typography:** Barlow 500–900 supplies the condensed arcade feel with strong display hierarchy and readable smaller copy. It is a close freely available match; the concept does not provide a font file. Button labels, score hierarchy, line breaks and bold headings were compared directly. Long bot names intentionally truncate in the scoreboard and remain available in setup.
- **Spacing/layout:** Navy header, lavender opponent card, target ring, dice, two actions and navy player strip follow the selected composition. Rounded corners and elevation are preserved. Compact screens suppress supporting explanation paragraphs; rules remain available in the menu. At 390 × 844, the document extends 6 pixels into footer padding; no score, action or menu control is concealed. Desktop uses a centered, scrollable 460-pixel game column.
- **Colors/tokens:** The yellow court, navy type/panels, lavender defense/opponent surfaces, orange concealment and cream revealed dice follow the reference. UI contrast and focus indicators remain legible.
- **Image quality:** Generated logo, court and target-ring assets follow the reference palette and are self-hosted WebP. Phosphor supplies interface icons. Dice are deliberately real 3D geometry, as requested, rather than a static picture. Real-time pose, side pips and lighting consequently differ from the concept's pre-rendered dice; these are expected functional differences, not a claim of pixel identity.
- **Copy/content:** The matched comparison reproduces the game's core labels and instructions. Added roll/reveal, committed move, result, handoff, winner and rematch states use the frozen K3-E1 rules. The shipped game does not contain mock scores or a hidden demonstration match.

## Functional verification

- Build succeeds; all 62 engine/simulator tests pass.
- Browser tested: rolling, selecting the right die with Enter, selecting the left die with a click, locked Attack and Defense, revealing the remaining die, exact score/target updates, pass-device privacy, new-match setup, strategist-v2 worker turn, Player 1 win and rematch.
- Unit coverage includes both physical die indices, no reroll/reordering, invalid selection rejection, hidden-value exclusion from public state, committed-action locking, score and Kaputt terminal states, and Extreme parity.
- Inspected desktop rendering plus 390 × 844 and 320 × 568 mobile layouts.
- Checked browser warnings/errors. No application errors; browser-extension metadata errors are unrelated to the app.
- Cloud browser ran the software 3D renderer because GPU/WebGL was unavailable. The WebGL path builds, but physical GPU-device rendering and external LLM-provider calls were not exercised here. Existing provider-key and proxy behavior is preserved.
- Worker D1 uploads were not exercised during local verification; completed local test matches did not write production data.

## Follow-up polish

- P3: further tune GPU-device materials and contact shadows toward the exact pre-rendered reference.
- P3: optional optical refinements to numeral shapes, ring thickness and the last few pixels of footer padding.

## Implementation checklist

- [x] Preserve the selected concept's major visual hierarchy and assets.
- [x] Render spinning 3D dice and allow either physical die to be revealed first.
- [x] Keep the remaining die hidden until the move is committed.
- [x] Preserve game rules, bots, simulation access and match export.
- [x] Complete browser interaction, responsive and console checks.
- [x] Include the built renderer in `lab/` for the existing static deployment.
