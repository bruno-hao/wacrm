export interface ChatDraftSettingsInput {
  model: string
  systemPrompt: string | null
  chatDraftModel?: string | null
  chatDraftPrompt?: string | null
}

export function resolveChatDraftSettings(input: ChatDraftSettingsInput) {
  return {
    model: input.chatDraftModel?.trim() || input.model,
    prompt: input.chatDraftPrompt?.trim() || input.systemPrompt || '',
  }
}
