-- Google Business Profile review management and per-account OAuth credentials.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS google_reviews_model text NOT NULL DEFAULT 'openai/gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS google_reviews_prompt text;

CREATE TABLE IF NOT EXISTS google_business_profile_config (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  refresh_token text NOT NULL,
  account_name text NOT NULL,
  location_name text NOT NULL,
  business_name text NOT NULL DEFAULT 'M Vision Ótica Especializada',
  verified_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_business_profile_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_business_profile_select ON google_business_profile_config;
CREATE POLICY google_business_profile_select ON google_business_profile_config FOR SELECT
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_business_profile_insert ON google_business_profile_config;
CREATE POLICY google_business_profile_insert ON google_business_profile_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_business_profile_update ON google_business_profile_config;
CREATE POLICY google_business_profile_update ON google_business_profile_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_business_profile_delete ON google_business_profile_config;
CREATE POLICY google_business_profile_delete ON google_business_profile_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS google_business_profile_updated_at ON google_business_profile_config;
CREATE TRIGGER google_business_profile_updated_at
  BEFORE UPDATE ON google_business_profile_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
