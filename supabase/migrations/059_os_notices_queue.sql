-- ============================================================
-- 059_os_notices_queue.sql — queued sending for Avisos
--
-- Notices are now sent in the background, one at a time with a random 5-15 s
-- pause between messages. A notice starts as 'queued', turns 'sending' when
-- its turn comes and ends 'sent' or 'failed'. Idempotent.
-- ============================================================

ALTER TABLE os_notices DROP CONSTRAINT IF EXISTS os_notices_status_check;
ALTER TABLE os_notices
  ADD CONSTRAINT os_notices_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'failed'));

ALTER TABLE os_notices
  ADD COLUMN IF NOT EXISTS queued_at timestamptz;

CREATE INDEX IF NOT EXISTS os_notices_queue_idx
  ON os_notices (account_id, queued_at)
  WHERE status = 'queued';
