import { describe, expect, it } from 'vitest'
import { getChatAiToggleState } from './chat-toggle'

describe('getChatAiToggleState', () => {
  it('shows the per-conversation control when AI is configured, even if global auto-reply is off', () => {
    expect(getChatAiToggleState({ configured: true, active: true, globalAutoReply: false, paused: false }))
      .toEqual({ visible: true, checked: false, disabled: true })
  })
})
