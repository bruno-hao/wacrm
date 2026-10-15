-- ============================================================
-- 054_instagram.sql — Instagram direct messages in the inbox
--
--   instagram_config      one connected Instagram professional account per
--                         CRM account (Instagram API with Instagram Login).
--                         The access token is stored AES-256-GCM-encrypted
--                         (same encrypt() as ai_configs.api_key) and never
--                         returned to the browser.
--   contacts.ig_user_id   Instagram-scoped ID (IGSID) of the sender; unique
--                         per account, like wa_user_id (migration 040).
--                         The @username is kept in contacts.wa_username
--                         (display only), `phone` stays '' for these.
--   conversations.channel 'whatsapp' (default, every existing row) or
--                         'instagram'.
--
-- RLS mirrors ai_configs: members read, admin+ write. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS instagram_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ig_user_id       text NOT NULL UNIQUE,   -- webhook entry.id / "me" of the token
  username         text,
  access_token     text NOT NULL,          -- AES-256-GCM-encrypted long-lived token
  token_expires_at timestamptz,
  status           text NOT NULL DEFAULT 'connected'
                     CHECK (status IN ('connected', 'disconnected')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instagram_config_select ON instagram_config;
CREATE POLICY instagram_config_select ON instagram_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS instagram_config_insert ON instagram_config;
CREATE POLICY instagram_config_insert ON instagram_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS instagram_config_update ON instagram_config;
CREATE POLICY instagram_config_update ON instagram_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS instagram_config_delete ON instagram_config;
CREATE POLICY instagram_config_delete ON instagram_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_instagram_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS instagram_config_updated_at ON instagram_config;
CREATE TRIGGER instagram_config_updated_at
  BEFORE UPDATE ON instagram_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_instagram_config_updated_at();

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ig_user_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_ig_user_id
  ON contacts (account_id, ig_user_id)
  WHERE ig_user_id IS NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp', 'instagram'));
