-- ============================================================
-- 052_ssotica_os_status.sql
--
-- Status of each customer's last service order, for the contact panel:
--   last_os_status  ssOtica status (ABERTO, FECHADO, VENDIDO, VELADO,
--                   ENTREGUE, CANCELADO, PERDA)
--   last_os_etapa   current production stage (etapa_atual), may be empty
--   last_os_sold    true when the OS is linked to a sale
-- Idempotent.
-- ============================================================

ALTER TABLE ssotica_customers
  ADD COLUMN IF NOT EXISTS last_os_status text,
  ADD COLUMN IF NOT EXISTS last_os_etapa  text,
  ADD COLUMN IF NOT EXISTS last_os_sold   boolean;
