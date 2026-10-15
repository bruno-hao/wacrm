-- ============================================================
-- 056_ssotica_quote_links.sql — OS and sale numbers of each budget
--
-- The budget screen only carries ssOtica's opaque hashes for the service
-- order and the sale created from a budget. The numbers (shown in the deal
-- title "ORC 149 / OS 1256 / VEN 1200") are resolved once and cached here,
-- so a re-sync does not repeat the lookups. Idempotent.
-- ============================================================

ALTER TABLE ssotica_quotes
  ADD COLUMN IF NOT EXISTS os_hash     text,
  ADD COLUMN IF NOT EXISTS os_number   text,
  ADD COLUMN IF NOT EXISTS sale_hash   text,
  ADD COLUMN IF NOT EXISTS sale_number text,
  ADD COLUMN IF NOT EXISTS links_checked_at timestamptz;
