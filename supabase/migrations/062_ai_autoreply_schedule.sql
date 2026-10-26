-- Weekly, timezone-aware availability for automatic AI replies.
-- One JSONB value keeps the enabled flag, timezone and seven-day schedule
-- atomic. Existing accounts remain 24/7 because the schedule starts disabled.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_reply_schedule jsonb NOT NULL DEFAULT
  '{
    "enabled": false,
    "timezone": "America/Sao_Paulo",
    "days": {
      "monday": [],
      "tuesday": [],
      "wednesday": [],
      "thursday": [],
      "friday": [],
      "saturday": [],
      "sunday": []
    }
  }'::jsonb;

COMMENT ON COLUMN ai_configs.auto_reply_schedule IS
  'Weekly AI auto-reply availability; ranges use local HH:mm and may cross midnight.';
