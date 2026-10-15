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

#### WAHA (NOWEB engine) behaviours that are easy to get wrong
- The session webhook subscribes to `message`, `message.any`, `message.ack`, `message.reaction`, `session.status` and `engine.event` (set by `wahaEnsureSession`; a live session must be updated with `PUT /api/sessions/default` when this list changes).
- **Messages we send from other devices** (phone, WhatsApp Web) only arrive in `message.any` with `fromMe=true`. `message` is inbound-only, so each event type handles exactly one direction (`translateMessage`). NOWEB leaves `to` empty on these and puts the chat id in `from`; the phone comes from `_data.key.remoteJidAlt` for `@lid` chats. They are stored as `agent` messages (`storeMirroredOutbound`) with no unread bump, flows, automations or AI.
- **Echo of CRM sends**: messages sent from the CRM are stored under WAHA's bare id (`3EB0…`) while echoes/acks carry `true_<chat>_3EB0…` (chat part can differ, `@c.us` vs `@lid`). Always match on the trailing id: `message_id.eq.<id>,message_id.like.*_<id>`. Skipping this duplicates every CRM-sent message and freezes its delivery ticks at "sent".
- **Read on another device**: NOWEB emits no `message.ack` for it. The CRM listens to the raw `engine.event` `messages.update` (`key.fromMe=false`, `update.status >= 4`) and clears the unread badge (`markInboundRead`).
- Do not log raw `engine.event` payloads: `creds.update` carries private keys.
- Contact names come from the sender's WhatsApp `pushName`; on our own messages it is OUR name and must not be used.

#### Phone numbers
Stored exactly as WAHA/WhatsApp report them (many older Brazilian mobiles have no ninth digit). Screens show them through `formatPhoneDisplay` / `displayContactHandle` (`+55 (xx) 9xxxx-xxxx`, landline `+55 (xx) xxxx-xxxx`); this is **display only**, never write the masked form back. Matching against external systems uses `brazilianCanonical` (always with the ninth digit).

### ssOtica integration (read-only API Consultiva)
- Credentials: Settings → ssOtica (`ssotica_config`: encrypted API key, CNPJ, optional `store_hash`, the short store code in ssOtica web URLs). Saving requires a passing "Test key"; the server repeats the test. Client: `lib/ssotica/client.ts` (`GET https://app.ssotica.com.br/api/v1`, Bearer key + `cnpj`; **never call `POST /login`**, it invalidates the user's key).
- The API has **no phone search** and allows 60 calls/min per store, so `lib/ssotica/sync.ts` mirrors customers into `ssotica_customers` (canonical phones, last OS number/date/status/stage/sold flag, last receipt date, last sale number/date/value, and the seller — first name of the last sale's `funcionario`, falling back to the last OS's; migration 053). Cron `GET /api/cron/ssotica-sync` (every 10 min, same `x-cron-secret`) runs a budgeted pass: backfill customers → 3 years of sales → OS in 180-day windows (several runs), then incremental over the last days. State lives in `ssotica_sync_state`; `phase='live'` means the index is trustworthy. To re-read a dataset after adding columns, set the phase back (`phase='os'`, `cursor_date=null`) and run the cron.
- Conversation list: `POST /api/ssotica/customers` (batch, `useSsoticaStatuses`) feeds a blue/red dot next to the status dot of each row; nothing is shown until `phase='live'`, so nobody is called "new" by mistake.
- UI: `GET /api/ssotica/customer?phone=` answers `customer | new | unavailable` from the index; badges "Cliente ssOtica" (blue) / "Cliente Novo" (red) in the chat header, and a yellow seller badge beside them (only when a seller is linked), and the centred detail list in the contact panel (`components/inbox/ssotica-badges.tsx`: name, O.S. nº, O.S. date with days since, situation, stage, sale, value, date). Stage ("Etapa da O.S.") is only kept/shown for a sold, non-cancelled/lost OS. Sale number and value link to `…/movimentacao/vendas/<store_hash>/listar?nsa_venda_Venda=<n>`; the API returns **no** code for OS pages or prescription images, so those are plain text.

### Inbox UI conventions
- Every conversation shows a `ChannelBadge` (`components/inbox/channel-badge.tsx`: WhatsApp green, Instagram pink; icon-only in the list, full pill in the thread header). The list has an **Origem** filter (all / WhatsApp / Instagram) beside Status and Tags, based on `conversation.channel ?? 'whatsapp'`.
- Contact panel: double-click the name to rename (writes `contacts.name` through the RLS client); the **+** beside Tags opens a popup to add/remove tags through `lib/contacts/tag-api.ts` (so `tag_added` automations still fire).
- Settings rail order = the order of `SETTINGS_SECTIONS` in `components/settings/settings-sections.ts` (Instagram sits right below WhatsApp). New dashboard routes also need `protectedPaths` in `middleware.ts`; `/avisos` (menu "Avisos") is a placeholder page.

### Instagram DMs (`lib/instagram`, migration 054)
- Channel = `conversations.channel` (`whatsapp` default | `instagram`). An Instagram contact has `contacts.ig_user_id` (IGSID), `phone = ''` and its @username in `wa_username`. Connection per account in `instagram_config` (token AES-GCM-encrypted, 60 days).
- **Instagram API with Instagram Login**, not Facebook Login. Env (deployment-wide): `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN` (webhook GET handshake), plus `NEXT_PUBLIC_SITE_URL` (OAuth redirect `/api/instagram/oauth/callback`, webhook `/api/instagram/webhook`). Webhook signatures are accepted with `INSTAGRAM_APP_SECRET` or `META_APP_SECRET` (`lib/instagram/security.ts`). Settings → Instagram shows the URLs to paste in the Meta app.
- Inbound (`inbound.ts`, payload parsing in pure `events.ts`): idempotent on `(conversation_id, message_id)`. **Echoes** (`is_echo`: sent by the CRM, the Instagram app or another tool) arrive on the same webhook; they upsert as `agent` rows, so the CRM's own send and its echo collapse into one row — keep both writers on `upsert … ignoreDuplicates`. Attachments are mirrored (`mirrorInboundMedia`, CDN links expire). A **new** conversation is INSERTed already carrying `last_message_text`, `last_message_at` and `unread_count` (and skips the bump RPC): the inbox hydrates a conversation as soon as its INSERT arrives over realtime, and a follow-up UPDATE a few ms later could be missed, leaving "no messages yet" in the list.
- Outbound: `send-message.ts` hands `channel='instagram'` to `lib/instagram/send.ts` (text or one media attachment, replies only). Window: free 24 h, up to 7 days with the `HUMAN_AGENT` tag (`sendWindow`), then blocked; the thread timer uses 168 h for Instagram. No templates, buttons, voice notes, automations, flows or AI on Instagram (by design for v1).
- `GET /api/cron/instagram-refresh` (daily, `x-cron-secret`) refreshes tokens expiring within 15 days; an unrecoverable one flips `status` to `disconnected`. No App Review is needed while the app only serves the owner's own account (Standard Access): the Instagram profile just has to be an *Instagram Tester* of the app and have "Allow access to messages" on. An account can also be connected without the OAuth screen by saving a dashboard-generated token (encrypted with `ENCRYPTION_KEY`) into `instagram_config`, after `POST /me/subscribed_apps`.

### Engines and cron
- `lib/automations/engine.ts` (trigger → conditions → steps, with Wait steps) and `lib/flows/engine.ts` (DB-stored node graph walked per contact, suspending at input nodes; idempotent per Meta message id, optimistic `current_node_key` updates, one active run per contact via partial unique index) both send through their own `meta-send.ts`.
- Wait steps and flow timeouts are drained by `GET /api/automations/cron` and `/api/flows/cron`, protected by header `x-cron-secret` = `AUTOMATION_CRON_SECRET`. Nothing schedules them for you: production hits them every minute from host cron.
- AI assistant (`lib/ai`): bring-your-own OpenAI/Anthropic/OpenAI-compatible key per account (stored encrypted); knowledge base with Postgres full-text and optional pgvector.
- Audio transcription is **on demand, never automatic**: with `ai_configs.transcription_enabled` on (OpenAI / OpenAI-compatible provider only, default model `whisper-large-v3-turbo` on Groq), audio bubbles show a "transcrever áudio" shortcut (`components/inbox/audio-transcription.tsx`) that calls `POST /api/ai/transcribe-message`, stores the text in `messages.content_text` and shows it in italics. It reuses the assistant's base URL and key (`lib/ai/transcribe.ts`).

### i18n
UI language is one build-time locale, `NEXT_PUBLIC_APP_LOCALE` (`en|pt|es|ko`, default `en`), loaded from `messages/<locale>.json` through the `@app-messages` alias (`src/i18n`, next-intl). Server/lib code uses `getT("Namespace.key")` from `lib/i18n/translate`. New user-visible strings go in **all four** catalogues. Changing the locale needs a rebuild.

### Database
`supabase/migrations/NNN_*.sql` (sequential, currently up to 054). CI (`migrations.yml`) only validates them on a throwaway Postgres (`supabase/ci/verify-schema.sql`); **it never applies them to a real project**. Apply new migrations manually (Supabase SQL editor or `supabase db push`) **before** deploying an image that reads the new columns. Recent ones: 049 (transcription flags, `ssotica_config`), 050 (`ssotica_customers`, `ssotica_sync_state`), 051 (`store_hash`), 052 (OS status/stage/sold). `supabase/ci/verify-schema.sql` is a single `DO` block; add assertions inside it.

### Deploy
`output: "standalone"`; `Dockerfile` is multi-stage. `NEXT_PUBLIC_*` values are inlined at build time (Docker build args / repo Variables), so changing them requires a rebuild. The `publish-image.yml` action (manual `workflow_dispatch`) builds and pushes `ghcr.io/<owner>/wacrm:latest`; the server then does `docker compose pull && docker compose up -d`. Server-only secrets are runtime env, never baked into the image. See `docs/docker.md`.
