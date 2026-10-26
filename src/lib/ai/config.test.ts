import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  base_url: null,
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  auto_reply_schedule: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    days: {
      monday: [{ start: '08:00', end: '12:00' }],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
  },
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.baseUrl).toBeNull()
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.autoReplySchedule).toEqual(ROW.auto_reply_schedule)
  })

  it('fails a corrupt enabled schedule closed without disabling manual AI', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const config = await loadAiConfig(
      dbReturning({ ...ROW, auto_reply_schedule: { enabled: true } }),
      'acct',
      { requireActive: false },
    )

    expect(config).not.toBeNull()
    expect(config!.autoReplySchedule.enabled).toBe(true)
    expect(Object.values(config!.autoReplySchedule.days).flat()).toEqual([])
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('schedule'),
      expect.any(Error),
    )
    error.mockRestore()
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})
