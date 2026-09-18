# Kaputt Cloudflare Lab

Cloudflare Worker + static Lab assets + D1 telemetry.

## One-time setup

1. Install Wrangler and authenticate.
2. From `cloudflare/`, run `npx wrangler d1 create kaputt-lab`.
3. Put the returned database id into `wrangler.toml`.
4. Run `npx wrangler d1 migrations apply kaputt-lab --remote`.
5. Deploy with `npx wrangler deploy`.

Endpoints:
- `GET /api/health`
- `POST /api/experiments`
- `POST /api/matches`
- `GET /api/stats`

API keys for future LLM adapters must remain browser-side or be handled transiently by a no-log proxy; never persist provider keys in D1.
