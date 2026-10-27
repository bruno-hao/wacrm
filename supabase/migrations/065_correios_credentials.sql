-- Encrypted Meu Correios credentials and reusable API token per account.
CREATE TABLE IF NOT EXISTS correios_credentials (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  username text NOT NULL,
  password text NOT NULL,
  access_token text,
  token_expires_at timestamptz,
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE correios_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS correios_credentials_select ON correios_credentials;
CREATE POLICY correios_credentials_select ON correios_credentials FOR SELECT
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS correios_credentials_insert ON correios_credentials;
CREATE POLICY correios_credentials_insert ON correios_credentials FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS correios_credentials_update ON correios_credentials;
CREATE POLICY correios_credentials_update ON correios_credentials FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS correios_credentials_delete ON correios_credentials;
CREATE POLICY correios_credentials_delete ON correios_credentials FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS correios_credentials_updated_at ON correios_credentials;
CREATE TRIGGER correios_credentials_updated_at
  BEFORE UPDATE ON correios_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
