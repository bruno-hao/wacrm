-- ============================================================
-- 058_os_notices.sql — customer notices sent from the Avisos page
--
-- One row per (service order, quick reply) message sent to the customer, so
-- the same notice is never sent twice and the delivery icon (sending / sent /
-- failed) survives reloads. Written by the service role (the send route);
-- members can read. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS os_notices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  os_number        text NOT NULL,
  os_date          date,
  customer_name    text,
  quick_reply_id   uuid REFERENCES quick_replies(id) ON DELETE SET NULL,
  quick_reply_title text,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'sending'
                     CHECK (status IN ('sending', 'sent', 'failed')),
  error            text,
  sent_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- A given notice (quick reply) goes out once per OS. A failed attempt keeps
-- its row, so it can be retried without creating a second one.
CREATE UNIQUE INDEX IF NOT EXISTS os_notices_unique_idx
  ON os_notices (account_id, os_number, quick_reply_id);

CREATE INDEX IF NOT EXISTS os_notices_os_idx ON os_notices (account_id, os_number);

ALTER TABLE os_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_notices_select ON os_notices;
CREATE POLICY os_notices_select ON os_notices FOR SELECT
  USING (is_account_member(account_id));
