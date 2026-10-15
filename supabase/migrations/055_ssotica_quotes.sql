-- ============================================================
-- 055_ssotica_quotes.sql — ssOtica budgets (orçamentos) → pipeline deals
--
-- The ssOtica Consultative API has no budgets endpoint; the budgets screen
-- reads them from the web app (session login). With the admin's explicit
-- consent the CRM keeps a web login used ONLY to read budgets:
--   ssotica_config.web_login      e-mail / user of that login
--   ssotica_config.web_password   AES-256-GCM-encrypted password
--   ssotica_config.web_session    AES-256-GCM-encrypted cookie jar, reused
--                                 until it expires (avoids a login per run)
--   ssotica_config.web_verified_at last successful "Test login"
--
-- ssotica_quotes ties each ssOtica budget to the deal created for it, so a
-- re-sync updates instead of duplicating. Written by the service role only.
-- Idempotent.
-- ============================================================

ALTER TABLE ssotica_config
  ADD COLUMN IF NOT EXISTS web_login text,
  ADD COLUMN IF NOT EXISTS web_password text,
  ADD COLUMN IF NOT EXISTS web_session text,
  ADD COLUMN IF NOT EXISTS web_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS ssotica_quotes (
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quote_id     text NOT NULL,                       -- ssOtica hashed_id
  number       text,
  deal_id      uuid REFERENCES deals(id) ON DELETE SET NULL,
  status       text,                                -- ATIVO | CONVERTIDO | CANCELADO | EXPIRADO
  content_hash text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, quote_id)
);

CREATE INDEX IF NOT EXISTS ssotica_quotes_deal_idx ON ssotica_quotes (deal_id);

ALTER TABLE ssotica_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ssotica_quotes_select ON ssotica_quotes;
CREATE POLICY ssotica_quotes_select ON ssotica_quotes FOR SELECT
  USING (is_account_member(account_id));
