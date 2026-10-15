-- ============================================================
-- 050_ssotica_customer_index.sql
--
-- Local index of ssOtica customers, so the inbox can answer "is this
-- WhatsApp number a ssOtica customer, and what was their last OS / sale?"
-- instantly. The ssOtica API has no phone search and allows 60 calls a
-- minute, so a cron (/api/cron/ssotica-sync, every 10 minutes) fills this
-- table in the background.
--
--   ssotica_customers   one row per (account, ssOtica customer). `phones`
--                       holds canonical digits (Brazilian mobiles always
--                       with the ninth digit) and is what lookups hit.
--   ssotica_sync_state  per-account cursor of the sync (customers → sales
--                       → service orders backfill, then incremental).
--
-- Written only by the service role (the cron); members can read.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS ssotica_customers (
  account_id        uuid   NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ssotica_id        bigint NOT NULL,
  name              text,
  phones            text[] NOT NULL DEFAULT '{}',
  last_os_number    text,
  last_os_date      date,
  last_receita_date date,
  last_sale_number  text,
  last_sale_date    date,
  last_sale_value   numeric(12,2),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, ssotica_id)
);

CREATE INDEX IF NOT EXISTS ssotica_customers_phones_idx
  ON ssotica_customers USING gin (phones);

ALTER TABLE ssotica_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ssotica_customers_select ON ssotica_customers;
CREATE POLICY ssotica_customers_select ON ssotica_customers FOR SELECT
  USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS ssotica_sync_state (
  account_id      uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  phase           text NOT NULL DEFAULT 'customers'
                    CHECK (phase IN ('customers', 'sales', 'os', 'live')),
  page            integer NOT NULL DEFAULT 1,
  cursor_date     date,                 -- start of the 180-day window being walked
  live_since      date,                 -- last day fully covered by the incremental pass
  running_until   timestamptz,          -- soft lock against overlapping runs
  last_run_at     timestamptz,
  last_error      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ssotica_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ssotica_sync_state_select ON ssotica_sync_state;
CREATE POLICY ssotica_sync_state_select ON ssotica_sync_state FOR SELECT
  USING (is_account_member(account_id));
