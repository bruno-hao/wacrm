# AI Auto-Reply Schedule and VPS Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly, timezone-aware schedule for AI auto-replies and standardize the M Vision VPS containers on `America/Sao_Paulo`.

**Architecture:** Store the complete weekly schedule as one validated JSONB value on `ai_configs`. Evaluate it immediately after loading the AI configuration, before every downstream auto-reply side effect. Keep infrastructure timezone explicit in images and Compose because Docker has no daemon-wide container timezone setting.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Supabase/PostgreSQL, Docker Compose.

**Spec:** User-approved plan in the Codex task dated 2026-10-26.

## Global Constraints

- Schedule affects automatic replies only; drafts, Playground, and transcription remain available.
- Outside schedule, stay completely silent and do not schedule retroactive replies.
- Use `America/Sao_Paulo`; intervals are start-inclusive and end-exclusive.
- An overnight interval belongs to its start day and may wrap Sunday to Monday.
- Preserve current production behavior by defaulting the schedule to disabled.
- Apply the production migration before deploying code that reads the new column.

## Task 1: Schedule domain and persistence

- [ ] Write failing unit tests for parsing, validation, multiple ranges, boundaries, overnight ranges, week wrap, empty week, timezone independence, and invalid inputs.
- [ ] Implement schedule types, defaults, normalization, validation, summary, and active-time evaluation.
- [ ] Add migration 062 and schema smoke assertion.
- [ ] Extend `AiConfig` loading and config API serialization/persistence, preserving stored schedule when omitted.
- [ ] Run targeted tests, typecheck, and commit.

## Task 2: Auto-reply gate

- [ ] Write failing auto-reply tests proving an inactive schedule short-circuits before all downstream work and an active schedule keeps existing behavior.
- [ ] Add the early schedule gate.
- [ ] Verify targeted and full AI tests, then commit.

## Task 3: Configuration UI

- [ ] Build a focused schedule editor using existing WACRM cards, switches, inputs, popovers, dialogs, and responsive layout conventions.
- [ ] Support day toggles, multiple ranges, overnight labels, copy-to selected days with overwrite confirmation, empty-week warning, timezone select, and compact summary.
- [ ] Wire the editor to config GET/POST and add all four locale catalogues.
- [ ] Add behavior tests for schedule editing utilities and run lint/typecheck/tests, then commit.

## Task 4: Image and Compose timezone defaults

- [ ] Add `tzdata` and `TZ=America/Sao_Paulo` to the runtime image.
- [ ] Add the Compose/runtime variable and environment example/documentation.
- [ ] Build the image locally and commit.

## Task 5: Review, publish, migrate, and deploy

- [ ] Run full lint, typecheck, tests, build, migration validation, and final independent code review.
- [ ] Push main and run `publish-image.yml`; wait for success.
- [ ] Back up production Compose/environment files.
- [ ] Apply migration 062 to Supabase.
- [ ] Change host and all project Compose timezones to `America/Sao_Paulo`, recreating and validating projects sequentially.
- [ ] Deploy the published WACRM image and verify container/image identity, HTTP health, Node/OS time, WAHA sessions, n8n, PostgreSQL, Redis, cron, and Portainer.
- [ ] Update and commit the VPS operational guide.

## Review Focus

- Overnight ranges must inspect both the current day and the previous day's wrapping ranges.
- Malformed enabled schedules must fail closed without triggering any downstream auto-reply work.
- Omitting `auto_reply_schedule` from a config POST must not overwrite the stored value.
- Container timezone verification must not rely only on an environment variable; WACRM must have zoneinfo and report `-03` at runtime.
