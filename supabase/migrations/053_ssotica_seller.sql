-- ============================================================
-- 053_ssotica_seller.sql
--
-- Seller (funcionário) linked to each ssOtica customer: the seller of the
-- customer's last sale, or of the last OS when there is no sale.
-- Shown as a yellow badge in the chat header. Idempotent.
-- ============================================================

ALTER TABLE ssotica_customers
  ADD COLUMN IF NOT EXISTS last_seller text;
