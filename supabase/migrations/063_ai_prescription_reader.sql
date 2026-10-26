-- Private, internal-only prescription reader configuration and results.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS prescription_reader_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prescription_reader_model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prescription_reader_prompt text;

UPDATE ai_configs
SET auto_reply_max_per_conversation = 20
WHERE auto_reply_max_per_conversation < 20;

CREATE TABLE IF NOT EXISTS ai_prescription_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result_text text,
  error_code text,
  model text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);

CREATE OR REPLACE FUNCTION public.validate_ai_prescription_read_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = NEW.message_id
      AND m.conversation_id = NEW.conversation_id
      AND c.account_id = NEW.account_id
      AND m.sender_type = 'customer'
      AND m.content_type = 'image'
  ) THEN
    RAISE EXCEPTION 'prescription read message is outside account scope';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_prescription_reads_scope ON ai_prescription_reads;
CREATE TRIGGER ai_prescription_reads_scope
  BEFORE INSERT OR UPDATE ON ai_prescription_reads
  FOR EACH ROW EXECUTE FUNCTION public.validate_ai_prescription_read_scope();

CREATE INDEX IF NOT EXISTS idx_ai_prescription_reads_conversation
  ON ai_prescription_reads(account_id, conversation_id, updated_at DESC);

ALTER TABLE ai_prescription_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_prescription_reads_select ON ai_prescription_reads;
CREATE POLICY ai_prescription_reads_select ON ai_prescription_reads FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_prescription_reads_insert ON ai_prescription_reads;
CREATE POLICY ai_prescription_reads_insert ON ai_prescription_reads FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_prescription_reads_update ON ai_prescription_reads;
CREATE POLICY ai_prescription_reads_update ON ai_prescription_reads FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_ai_prescription_reads_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS ai_prescription_reads_updated_at ON ai_prescription_reads;
CREATE TRIGGER ai_prescription_reads_updated_at
  BEFORE UPDATE ON ai_prescription_reads
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_prescription_reads_updated_at();
