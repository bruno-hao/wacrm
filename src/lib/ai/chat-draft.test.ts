import { describe, expect, it } from 'vitest'
import { resolveChatDraftSettings } from './chat-draft'

describe('resolveChatDraftSettings', () => {
  it('uses the dedicated model and prompt when configured', () => {
    expect(resolveChatDraftSettings({ model: 'main-model', systemPrompt: 'main', chatDraftModel: 'draft-model', chatDraftPrompt: 'draft prompt' }))
      .toEqual({ model: 'draft-model', prompt: 'draft prompt' })
  })

  it('falls back to the main assistant model and prompt', () => {
    expect(resolveChatDraftSettings({ model: 'main-model', systemPrompt: 'main', chatDraftModel: null, chatDraftPrompt: null }))
      .toEqual({ model: 'main-model', prompt: 'main' })
  })
})
