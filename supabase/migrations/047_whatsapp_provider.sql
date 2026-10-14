-- ============================================================
-- 047: pluggable WhatsApp provider (Meta Cloud API | WAHA)
--
-- An account picks ONE transport for its WhatsApp number:
--   'meta' — official Cloud API (default; existing behaviour)
--   'waha' — a WAHA server (WhatsApp Web session, QR-code pairing)
--
-- For a 'waha' row:
--   phone_number_id      = 'waha:<account_id>' (synthetic, keeps the
--                          UNIQUE constraint from migration 013 happy and
--                          tells the send helpers to route to WAHA)
--   access_token         = encrypted JSON {"u": baseUrl, "k": apiKey, "s": session}
--   waha_webhook_secret  = random secret embedded in the webhook URL WAHA
--                          calls (WAHA has no Meta-style app signature)
--   waha_send_delay_ms   = minimum pause between outbound broadcast sends
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS waha_base_url TEXT,
  ADD COLUMN IF NOT EXISTS waha_session TEXT,
  ADD COLUMN IF NOT EXISTS waha_webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS waha_send_delay_ms INTEGER NOT NULL DEFAULT 4000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_provider_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_check
      CHECK (provider IN ('meta', 'waha'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_waha_webhook_secret_key
  ON whatsapp_config (waha_webhook_secret)
  WHERE waha_webhook_secret IS NOT NULL;
