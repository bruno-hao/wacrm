-- Correios shipment tracking and customer notifications.
CREATE TABLE IF NOT EXISTS correios_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tracking_code text NOT NULL,
  os_date date NOT NULL,
  os_number text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  order_value numeric(12,2) NOT NULL DEFAULT 0,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  last_status_code text,
  last_status_text text,
  last_event_at timestamptz,
  last_checked_at timestamptz,
  last_notified_fingerprint text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, tracking_code)
);

CREATE INDEX IF NOT EXISTS idx_correios_shipments_account_updated
  ON correios_shipments(account_id, updated_at DESC);

ALTER TABLE correios_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS correios_shipments_select ON correios_shipments;
CREATE POLICY correios_shipments_select ON correios_shipments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS correios_shipments_insert ON correios_shipments;
CREATE POLICY correios_shipments_insert ON correios_shipments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS correios_shipments_update ON correios_shipments;
CREATE POLICY correios_shipments_update ON correios_shipments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS correios_shipments_delete ON correios_shipments;
CREATE POLICY correios_shipments_delete ON correios_shipments FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS correios_shipments_updated_at ON correios_shipments;
CREATE TRIGGER correios_shipments_updated_at
  BEFORE UPDATE ON correios_shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
