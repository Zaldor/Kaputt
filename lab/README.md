# KAPUTT! — Arcade Rivalry

The real K3-E1 play app, with the yellow arena, navy controls and lavender opponent scoreboard from the selected mobile concept. Static assets in this folder are served unchanged by Cloudflare Workers and GitHub Pages.

## Playing

1. Roll both dice. Both values stay hidden during the 3D tumble.
2. Tap **either** physical die to reveal it first. Keyboard users can Tab to either die and press Enter or Space.
3. Commit to Attack or Defense. The choice cannot be changed.
4. Tap the remaining die, or use **Reveal second die**.
5. Continue to the opponent's turn. Pass-and-play clears dice before handing over the device.

The menu contains new-match settings, rules, sound, the live match lab, JSON export and the existing simulation lab. All existing bot profiles and BYOK LLM opponents remain available. Heavy bots run in a Web Worker and receive only public state.

## Rules

The shared `engine.js` is now the single resolution source for the playable UI and simulation. Attack multiplies and must strictly exceed NtB; a failure adds a Kaputt. Defense scores the higher die and sets NtB to the sum. A 1–6 Extreme resolves Attack to 36, or Defense to target 2 / score 1. Doubles are normal. Default win conditions remain first to 100, or opponent reaching five Kaputts.

The engine accepts `revealFirst(0)` (left, default) or `revealFirst(1)` (right). Physical dice are never rerolled or reordered by this selection. Events include `firstDieIndex`, `visibleDie` and `hiddenDie`. Decision time stops at commitment.

## Development

From the repository root:

```sh
npm ci
npm run build
npm test
npm run dev
```

The app needs no server-side build to run. The committed `lab/dice-scene.js` bundle contains Three.js and is generated from `src/dice-scene.js` and `src/software-dice-renderer.js`. Rebuild and commit it after changing renderer source. Fonts, icons, artwork and renderer are self-hosted; gameplay does not depend on a CDN.

The renderer uses WebGL where available and a Canvas2D projection of the same 3D meshes if GPU contexts are unavailable. Both implementations tumble real geometry. Neither receives unrevealed die values. Animation respects reduced-motion preferences, stops rendering when idle, and caps device pixel ratio at 2. Accessible value buttons remain usable if all rendering fails.

The local dev server also supplies `/__preview?width=390&height=844` and a visual-only `/__preview?visual&width=390&height=844` fixture. Those routes do not exist in the deployed `lab/` directory. The fixture matches the selected concept's 42–58, target 12, visible 4 state and must not be used as a gameplay test.

## Persistence

Completed matches on the configured workers.dev deployment retain the existing `/api/matches` D1 upload. GitHub Pages/local games support JSON export without an API. Keys remain in browser storage; exports and match uploads do not contain credentials. LLM provider/model settings still use the existing adapter and proxy.
