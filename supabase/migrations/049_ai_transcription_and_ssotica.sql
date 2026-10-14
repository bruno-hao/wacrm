-- ============================================================
-- 049_ai_transcription_and_ssotica.sql
--
--   1. Audio transcription for the AI assistant: a per-account switch
--      and the model name. It reuses the assistant's own base URL and
--      key (OpenAI / OpenAI-compatible), so no extra secret is stored.
--   2. ssotica_config: credentials for the ssOtica "API Consultiva".
--      The API key is stored AES-256-GCM-encrypted (same encrypt() as
--      ai_configs.api_key) and never returned to the browser.
--
-- RLS mirrors ai_configs: any member may read the row (to show
-- "connected"), only admin+ may write. Idempotent.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS transcription_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transcription_model text NOT NULL DEFAULT 'whisper-large-v3-turbo';

CREATE TABLE IF NOT EXISTS ssotica_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cnpj         text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  api_key      text NOT NULL,               -- AES-256-GCM-encrypted ssOtica access key
  verified_at  timestamptz,                 -- last successful connection test
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ssotica_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ssotica_config_select ON ssotica_config;
CREATE POLICY ssotica_config_select ON ssotica_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ssotica_config_insert ON ssotica_config;
CREATE POLICY ssotica_config_insert ON ssotica_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ssotica_config_update ON ssotica_config;
CREATE POLICY ssotica_config_update ON ssotica_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ssotica_config_delete ON ssotica_config;
CREATE POLICY ssotica_config_delete ON ssotica_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ssotica_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ssotica_config_updated_at ON ssotica_config;
CREATE TRIGGER ssotica_config_updated_at
  BEFORE UPDATE ON ssotica_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ssotica_config_updated_at();
