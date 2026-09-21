# KAPUTT Cloudflare deployment

This is the **existing** `kaputt-lab` Worker and D1 database. Do not create or replace either resource. The production database ID remains `986e5b8a-e0e5-43cd-8db3-48e629fe398a`.

## Deploy safely with official Wrangler

```sh
npm ci
npx wrangler login --device
npm run cloudflare:preflight
npm run cloudflare:deploy -- --backup-dir /private/kaputt-backups
```

The preflight is read-only. Deployment first exports the existing database and records its Time Travel bookmark and row counts in the explicitly selected private directory. Keep that backup private and durable; never commit it or put it under `lab/`. It then applies pending **additive** migrations, checks that counts have not decreased, deploys the Worker and its assets together, and checks `/api/health`.

Migrations 0001–0004 are preserved from main. New migration 0005 adds room version numbers, seat credentials and action receipts. It does not modify existing match, turn, player or room rows beyond adding default-valued columns. The old `players` cache and UUID fields are retained; standings and badges are derived from durable records because the former cache missed first wins and used a non-unique UUID conflict target.

**Protocol transition:** deployment stops if a legacy room has been active within the last 30 minutes. Let those games finish. Existing legacy room history remains downloadable by room code through `/api/rooms/CODE/archive`. Legacy credentials were public and cannot safely become private seat credentials; a new room is required for the new protocol. No old room or match is deleted. An old tab should reload after deployment. Never force a database restore to roll back a UI change.

If migrations were previously applied manually without Wrangler's migration ledger, inspect the schema and ledger before proceeding; do not rerun an `ADD COLUMN` against an existing column. The script stops on Wrangler errors.

## Multiplayer contract

- `POST /api/rooms`: `hostName`, optional per-tab `playerId`, `sessionToken` (32 cryptographically random bytes encoded as 64 hex characters), and match configuration.
- `POST /api/rooms/CODE/join`: `guestName`, `playerId`, `sessionToken`.
- `GET /api/rooms/CODE`: requires `Authorization: Bearer <sessionToken>`. Optional `?since=VERSION` avoids retransmitting unchanged state/history.
- `POST /api/rooms/CODE/action`: same authorization plus `requestId`, `version`, and `action` (`roll`, `reveal`, `choose`, `resolve`, `next`, `rematch`, `leave`). Reveal takes `dieIndex`; choose takes `choice`; rematch includes `matchId`.
- Server owns both dice and scoring. No concealed die is sent to either client. Only the current player may move; selecting the first die and committing a move are irreversible.
- D1 batches atomically commit the room's compare-and-swap update, receipt, and final match/turn save. Exact request retries do not score twice. Both players must request a rematch; simultaneous requests merge safely.
- Public player IDs are labels for per-tab identity and rankings, **not authentication**. Only hashed secret seat tokens are stored in D1. Tokens never appear in links, exports or public room state.
- Polling pauses overlapping requests, slows in hidden tabs, drops stale responses, and retains a pending command across reloads. An interrupted chosen phase offers an explicit second reveal.

Other endpoints remain: `/api/matches`, `/api/experiments`, `/api/stats`, `/api/llm-proxy`, `/api/leaderboard?period=all|today|week|month`, and `/api/badges`. Periods use UTC and weeks begin Monday. Completed legacy rooms contribute to standings. Badges resolve turn actors to actual players and use the same identity across both seats.

## Local verification

`npm run dev` serves the real Worker via official Miniflare with an isolated, disposable local D1 database and all migrations. It never accesses production. Restarting the development server resets that database. `npm test` covers engine rules, simulations, two-player transitions, lost responses, authentication, concurrency, rollback, legacy preservation, periods and badges. `npx wrangler deploy --dry-run --config cloudflare/wrangler.toml` validates the production bundle and bindings without deploying.

The static GitHub Pages deployment supports local games; online rooms and shared rankings require the Worker host. LLM provider keys remain browser-side or pass transiently through the provider proxy; they are never stored in D1 or exported with a match.
