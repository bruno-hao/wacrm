alter table public.ai_configs
  add column if not exists chat_draft_model text,
  add column if not exists chat_draft_prompt text,
  add column if not exists disable_ai_on_agent_message boolean not null default false;

comment on column public.ai_configs.chat_draft_model is 'Model used by the agent that drafts manual chat replies';
comment on column public.ai_configs.chat_draft_prompt is 'System prompt used by the manual chat reply drafter';
comment on column public.ai_configs.disable_ai_on_agent_message is 'Pause automatic AI replies when an agent sends a message';
