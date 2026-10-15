-- ============================================================
-- 061_zapotica_columns.sql
--
--  * standard_messages.key   identifies the four after-sales messages
--    (adaptacao / limpeza / plaqueta / preventiva) so the Pós-Venda table
--    can give each one its own column.
--  * ssotica_customers.registered_at   "Cliente desde" (data_cadastro).
-- Idempotent.
-- ============================================================

ALTER TABLE standard_messages ADD COLUMN IF NOT EXISTS key text;

UPDATE standard_messages
   SET key = CASE title
     WHEN 'Adaptação de óculos e armação' THEN 'adaptacao'
     WHEN 'Limpeza' THEN 'limpeza'
     WHEN 'Substituição de plaqueta / plaqueta nasal' THEN 'plaqueta'
     WHEN 'Manutenção preventiva' THEN 'preventiva'
   END
 WHERE category = 'posvenda' AND key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS standard_messages_key_idx
  ON standard_messages (account_id, key) WHERE key IS NOT NULL;

ALTER TABLE ssotica_customers ADD COLUMN IF NOT EXISTS registered_at date;
