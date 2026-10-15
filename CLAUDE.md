# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm install                 # Node >=20, npm 10 (package-lock.json is authoritative; CI uses `npm ci`)
npm run dev                 # next dev (Turbopack), http://localhost:3000
npm run lint                # eslint
npm run typecheck           # tsc --noEmit
npm test                    # vitest run (all of src/**/*.test.{ts,tsx})
npx vitest run src/lib/whatsapp/send-message.test.ts   # single file
npx vitest run -t "part of test name"                  # single test by name
npm run test:watch
npm run format              # prettier --write . (CONTRIBUTING asks for typecheck + format before a PR)
npm run build               # next build --webpack
```

- CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build, with dummy `NEXT_PUBLIC_SUPABASE_*`, `ENCRYPTION_KEY` and `META_APP_SECRET`. `vitest.config.ts` injects the same dummy secrets, because `lib/whatsapp/encryption.ts` and `webhook-signature.ts` read them at module load. Keep the values in sync if you change one.
- **Production builds use webpack, not Turbopack** (`--webpack`): Turbopack's PostCSS workers crash on Hostinger's build container. `next.config.ts` therefore defines the `@app-messages` alias twice (Turbopack and webpack); change both.
- Copy `.env.local.example` to `.env.local`. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` (64 hex, AES-256-GCM; rotating it orphans every stored WhatsApp token), `META_APP_SECRET` (comma-separated list allowed for several Meta apps).

## Architecture

Next.js App Router (Next 16, React 19, Tailwind v4, shadcn + `@base-ui/react`) on a hosted **Supabase** project (Postgres + Auth + Storage + Realtime). There is no ORM and no separate backend: route handlers in `src/app/api` talk to Supabase directly. **Next 16 differs from older versions; follow AGENTS.md and read `node_modules/next/dist/docs/` before using Next APIs.**

### Multi-tenancy and auth
- Every table is scoped by `account_id` and protected by RLS. Users belong to an account with a role (`owner > admin > agent > viewer`, see `src/lib/auth/roles.ts`).
- Dashboard API routes call `requireRole(...)` from `src/lib/auth/account.ts`; it returns `{ supabase, userId, accountId, role }` using the cookie-bound SSR client (`lib/supabase/server.ts`, RLS applies). Map thrown errors with `toErrorResponse`.
- Server-side background work (webhooks, automation/flow engines, public API key auth) uses the **service-role** client (`SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS), via `lib/flows/admin-client.ts` / `lib/automations/admin-client.ts`. Always filter by `account_id` yourself there.
- `src/middleware.ts` refreshes the Supabase session and redirects unauthenticated users. **Every new top-level route under `src/app/(dashboard)/` must be added to `protectedPaths`** (`middleware.test.ts` enforces it). `/api/whatsapp/*` returns 401 without a session unless the path contains `/webhook`; anything that must be callable without a session (webhooks, cron, backfill) must live outside the session-guarded prefix, as `api/cron/contact-photos` was.
- Public REST API `/api/v1` (`src/app/api/v1`, `lib/api/v1`, `lib/api-keys`) authenticates with hashed, scoped API keys instead of sessions. Docs: `docs/public-api.md`. `mcp-server/` is a separate npm package wrapping that API (own `package.json`, not part of the root build).

### WhatsApp: two providers behind one interface
- Providers are **Meta Cloud API** (`lib/whatsapp/meta-api.ts`) and **WAHA** (`lib/whatsapp/waha-api.ts`). Rather than a provider switch everywhere, a WAHA account encodes itself into the same two values Meta callers already pass: `phoneNumberId = "waha:<account_id>"` and `accessToken = JSON {u,k,s}`; the `meta-api.ts` send helpers delegate to WAHA when `isWahaTarget()`. Keep new send paths going through these helpers.
- Inbound: Meta posts to `api/whatsapp/webhook` (HMAC check with `META_APP_SECRET`), WAHA to `api/whatsapp/waha/webhook`. Both feed `lib/whatsapp/inbound-processor.ts`, which resolves the sender identity (`wa-identity.ts`: phone-less username senders and WAHA `@lid` ids exist), dedupes/creates contacts and conversations, stores messages, then fans out to `resumeAwaitingReply` / `runAutomationsForTrigger` (automations), `dispatchInboundToFlows` (flows), `dispatchInboundToAiReply` (AI auto-reply), and outbound webhooks (`lib/webhooks`).
- Outbound: `lib/whatsapp/send-message.ts` is the single core used by both `/api/whatsapp/send` and `/api/v1/messages`. It throws `SendMessageError`; callers map it to their own response shape. Tokens are stored encrypted (`encryption.ts`).

### Engines and cron
- `lib/automations/engine.ts` (trigger → conditions → steps, with Wait steps) and `lib/flows/engine.ts` (DB-stored node graph walked per contact, suspending at input nodes; idempotent per Meta message id, optimistic `current_node_key` updates, one active run per contact via partial unique index) both send through their own `meta-send.ts`.
- Wait steps and flow timeouts are drained by `GET /api/automations/cron` and `/api/flows/cron`, protected by header `x-cron-secret` = `AUTOMATION_CRON_SECRET`. Nothing schedules them for you: production hits them every minute from host cron.
- AI assistant (`lib/ai`): bring-your-own OpenAI/Anthropic/OpenAI-compatible key per account (stored encrypted); knowledge base with Postgres full-text and optional pgvector.

### i18n
UI language is one build-time locale, `NEXT_PUBLIC_APP_LOCALE` (`en|pt|es|ko`, default `en`), loaded from `messages/<locale>.json` through the `@app-messages` alias (`src/i18n`, next-intl). Server/lib code uses `getT("Namespace.key")` from `lib/i18n/translate`. New user-visible strings go in **all four** catalogues. Changing the locale needs a rebuild.

### Database
`supabase/migrations/NNN_*.sql` (sequential, currently up to 050). CI (`migrations.yml`) only validates them on a throwaway Postgres (`supabase/ci/verify-schema.sql`); **it never applies them to a real project**. Apply new migrations manually (Supabase SQL editor or `supabase db push`).

### Deploy
`output: "standalone"`; `Dockerfile` is multi-stage. `NEXT_PUBLIC_*` values are inlined at build time (Docker build args / repo Variables), so changing them requires a rebuild. The `publish-image.yml` action (manual `workflow_dispatch`) builds and pushes `ghcr.io/<owner>/wacrm:latest`; the server then does `docker compose pull && docker compose up -d`. Server-only secrets are runtime env, never baked into the image. See `docs/docker.md`.
