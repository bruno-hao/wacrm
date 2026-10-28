export function getChatAiToggleState(input: {
  configured: boolean
  active: boolean
  globalAutoReply: boolean
  paused: boolean
}) {
  return {
    visible: input.configured && input.active,
    checked: input.globalAutoReply && !input.paused,
    disabled: !input.globalAutoReply,
  }
}
