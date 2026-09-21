# KAPUTT concept N3 and remote VS verification

Visual and local functional result: **passed**. Production Cloudflare/D1 verification awaits authentication; no production data has been modified by these tests.

## Current baseline and retained features

Integrated main through `1ae7847` (including per-tab UUID identities, leaderboard periods, badges, and the newer remote UI fixes). Existing engine rules, bot modes, LLM controls, simulation lab, exports, room configuration, UUID migration files, and all existing database tables are retained.

## Visual evidence

- Selected source: third concept, original 853 × 1844 image `exec-f3640e69-3f01-44d7-b763-873a23c744d1.png`.
- [Full comparison](docs/qa/concept-3-comparison.jpg): source left, current implementation right, both normalized to 390 × 844.
- [Matched game](docs/qa/mobile-390.jpg): target 12, opponent 58 / one Kaputt, player 42 / two Kaputts, left die 4, right die concealed, Attack/Defense controls visible.
- [Dice comparison](docs/qa/dice-comparison.jpg): same state and crop, source left, implementation right.
- [Compact game](docs/qa/compact-320.jpg): 320 × 568. DOM checks confirm document width/height equal viewport width/height. The 390 × 844 layout also has no horizontal or vertical overflow.
- The fixture is served only by the development server at `/__preview?visual&width=390&height=844`. Production starts a real empty match.

The smoother court image, navy/lavender button sprites, real alpha channels, iconography, and layout preserve the concept hierarchy. The individual button images and an accompanying atlas/metadata are in `lab/assets/`. A soft mask blends the court under the score panel without a background seam. Supporting rule copy follows the concept; compact phones move that detail into the existing How to Play sheet.

Dice are actual rotating geometry, with an on-demand Canvas2D projection when WebGL is unavailable. Lighting, side pips, numerals, and geometry differ from the pre-rendered concept; this is not a claim of pixel identity. The software-rendered path was visually inspected. Physical GPU-device rendering remains a follow-up check.

## Fixed findings

- **P1: client-controlled online dice and public seat identities.** Rolls and scoring are server-owned; private seat tokens are hashed in D1 and never exported. Public UUIDs remain identity labels and grant no seat access.
- **P1: concurrent joins, stale moves, retries, and partial final saves.** Compare-and-swap revisions and request receipts protect each atomic D1 batch. Tests inject a failed turn insert and confirm complete rollback and successful retry.
- **P1: broken online controls and local/remote state divergence.** One rendered model now follows authoritative room phases. The other player cannot act. No local bot or pass-device dialog runs during online play.
- **P1: lost reconnects and duplicate responses.** Per-tab sessions and pending commands survive reload; old poll responses cannot rewind a move; leaving invalidates in-flight work. Permanent session errors provide a new-match path.
- **P1: missing first wins and unsaved remote matches.** Completed matches and turns persist together. Derived standings include completed legacy rooms and numeric winner zero. Match-ID collisions cannot mix histories.
- **P1: wrong legacy winner on Kaputt loss.** Standings prefer the recorded result winner over the buggy top-level legacy winner, without rewriting the original room.
- **P2: rematches overwriting results or starting unilaterally.** Both players consent; simultaneous requests merge safely; the preceding match remains stored.
- **P2: badges awarded to P1/P2, duplicate-name identities, and period inconsistencies.** Turns resolve to actual players; UUIDs distinguish new identities; UTC periods and Monday-based weeks share the same standings dataset.
- **P2: auto-submitting room codes and silent errors.** Explicit Join, busy states, room code/share controls, reconnect status, safe Retry, leave confirmation, and previous-room history export replace the ambiguous flow.
- **P2: initial hidden Player 2 field, incorrect turn label, and encoding artifacts.** Setup shows the appropriate name fields; local handoff names and all game text are corrected.
- **P2: canvas moved away from hit targets.** The canvas stays inside the dice stage and uses its existing resize observer. Either physical die remains selectable.
- **P2: cut-off small-screen scores and overflowing leaderboard.** Compact spacing and responsive ranking cards preserve readable scores and touch controls.
- **P2: save failures discarded on new match.** Local completed games have stable IDs and a persistent retry queue; failures remain visible in Match lab.

## Motion and accessibility

Finite press/release, sheet entry, state transitions, die spin/reveal, choice lock, score/target emphasis, penalty feedback, outcome popup, and win celebration animations are included. They stop on visibility changes or game replacement. Both OS reduced-motion and the in-game animation toggle are respected. Semantic buttons, keyboard activation, focus rings, live announcements, safe-area padding, and text dice fallback remain available.

## Verification

- `npm run check`: **78 tests passed**, including frozen rule parity, both first-die choices, private values, action locking, score/Kaputt/Extreme outcomes, simulations, seat authentication, concurrent joins/actions/rematches, lost response/reload, late polls, leave invalidation, rollback, idempotent uploads, legacy preservation, periods, identities, and badges.
- `wrangler deploy --dry-run --config cloudflare/wrangler.toml`: passes with the existing D1 and asset bindings.
- Browser two-player journey: create, explicit join, waiting room, own/opponent turn controls, right-die selection, reload while deciding, Defense commit/automatic second reveal, synchronized scores, saved win/leaderboard entry, rematch request/acceptance, leave confirmation and opponent notification.
- Browser local journey: pass & play handoff/name, keyboard die selection, bot turn, reduced-motion toggle, menu/rules/lab access.
- Fresh final captures show no application errors. Browser-extension metadata errors are unrelated to the game.
- All browser test matches used the isolated local Worker/D1 runtime. No production test scores were created.

## Release gate

Use the documented official Wrangler deployment script. It checks for recently active legacy games, exports D1 privately, captures the Time Travel bookmark and row counts, applies only additive migrations, deploys the Worker/assets together, and checks health. Do not deploy while a legacy match is in progress. Older room records remain downloadable, but new private-seat play requires a new room. No database reset or recreation is needed.

Remaining limitations: production sign-in/backup/deploy verification; external paid LLM calls were not exercised; physical WebGL-device material tuning is optional visual polish. Legacy name-only records cannot be retrospectively assigned verified identities without inventing data.
