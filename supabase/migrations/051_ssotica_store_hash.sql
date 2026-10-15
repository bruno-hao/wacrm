-- ============================================================
-- 051_ssotica_store_hash.sql
--
-- The ssOtica web app addresses a store with a short opaque code in its
-- URLs (e.g. /movimentacao/vendas/<store_hash>/listar?nsa_venda_Venda=1200).
-- The API does not return it, so the admin pastes it once in
-- Settings > ssOtica; the CRM uses it to link a sale number to ssOtica.
-- Idempotent.
-- ============================================================

ALTER TABLE ssotica_config
  ADD COLUMN IF NOT EXISTS store_hash text
    CHECK (store_hash IS NULL OR store_hash ~ '^[A-Za-z0-9]{3,32}$');
