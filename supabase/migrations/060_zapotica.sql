-- ============================================================
-- 060_zapotica.sql — ZapÓtica: standard messages + new notice modules
--
--  * standard_messages  reusable messages by category (post-sale, expired
--    prescription, birthday), edited in Settings → Mensagens Padrão.
--  * os_notices         now tags each notice with its module and may point
--    at a standard message instead of a quick reply.
--  * ssotica_customers  keeps the customer's birth date (birthday list).
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS standard_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category     text NOT NULL
                 CHECK (category IN ('posvenda', 'receitas', 'aniversario')),
  title        text NOT NULL,
  content_text text NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS standard_messages_account_idx
  ON standard_messages (account_id, category, position);

ALTER TABLE standard_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS standard_messages_select ON standard_messages;
CREATE POLICY standard_messages_select ON standard_messages FOR SELECT
  USING (is_account_member(account_id));

ALTER TABLE os_notices
  ADD COLUMN IF NOT EXISTS module text NOT NULL DEFAULT 'avisos',
  ADD COLUMN IF NOT EXISTS standard_message_id uuid
    REFERENCES standard_messages(id) ON DELETE SET NULL;

ALTER TABLE os_notices DROP CONSTRAINT IF EXISTS os_notices_module_check;
ALTER TABLE os_notices
  ADD CONSTRAINT os_notices_module_check
  CHECK (module IN ('avisos', 'posvenda', 'receitas', 'aniversario'));

-- One notice per (module, reference, message): `os_number` holds the O.S.
-- number, or "<customer id>-<year>" for birthdays.
DROP INDEX IF EXISTS os_notices_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS os_notices_unique_idx
  ON os_notices (account_id, module, os_number, COALESCE(quick_reply_id, standard_message_id));

ALTER TABLE ssotica_customers
  ADD COLUMN IF NOT EXISTS birth_date date;
