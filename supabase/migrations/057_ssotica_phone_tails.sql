-- ============================================================
-- 057_ssotica_phone_tails.sql
--
-- A ssOtica customer can have several phones, and the same person is often
-- registered with a different DDD (or the WhatsApp number differs only in
-- the ninth digit). Lookups first try the exact canonical phone and then the
-- last 8 digits (`phone_tails`), the same tolerance the CRM uses to de-dupe
-- contacts. `customers_refreshed_at` lets the cron re-read the whole
-- customer list once a day, so phones edited in ssOtica reach the index.
-- Idempotent.
-- ============================================================

ALTER TABLE ssotica_customers
  ADD COLUMN IF NOT EXISTS phone_tails text[] NOT NULL DEFAULT '{}';

UPDATE ssotica_customers
   SET phone_tails = ARRAY(SELECT right(p, 8) FROM unnest(phones) AS p)
 WHERE phone_tails = '{}' AND cardinality(phones) > 0;

CREATE INDEX IF NOT EXISTS ssotica_customers_phone_tails_idx
  ON ssotica_customers USING gin (phone_tails);

ALTER TABLE ssotica_sync_state
  ADD COLUMN IF NOT EXISTS customers_refreshed_at timestamptz;
