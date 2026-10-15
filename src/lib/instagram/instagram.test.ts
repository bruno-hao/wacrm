import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeInstagramWebhook, sendWindow } from './events'
import { signOAuthState, verifyInstagramSignature, verifyOAuthState } from './security'

const ME = '17841400000000000'
const PEER = '9988776655'

const wrap = (messaging: unknown[]) => ({
  object: 'instagram',
  entry: [{ id: ME, time: 1, messaging }],
})

describe('normalizeInstagramWebhook', () => {
  it('reads an inbound text message', () => {
    const [ev] = normalizeInstagramWebhook(
      wrap([
        {
          sender: { id: PEER },
          recipient: { id: ME },
          timestamp: 1_800_000_000_000,
          message: { mid: 'm1', text: 'oi' },
        },
      ]),
    )
    expect(ev).toMatchObject({
      kind: 'message',
      accountIgId: ME,
      peerId: PEER,
      isEcho: false,
      timestamp: 1_800_000_000,
    })
    expect(ev.kind === 'message' && ev.parts).toEqual([
      { id: 'm1', contentType: 'text', text: 'oi', mediaUrl: null },
    ])
  })

  it('treats echoes as our own message and uses the recipient as the peer', () => {
    const [ev] = normalizeInstagramWebhook(
      wrap([
        {
          sender: { id: ME },
          recipient: { id: PEER },
          timestamp: 1,
          message: { mid: 'm2', text: 'olá', is_echo: true },
        },
      ]),
    )
    expect(ev).toMatchObject({ kind: 'message', isEcho: true, peerId: PEER })
  })

  it('maps attachments and gives extra parts unique ids', () => {
    const [ev] = normalizeInstagramWebhook(
      wrap([
        {
          sender: { id: PEER },
          recipient: { id: ME },
          timestamp: 1,
          message: {
            mid: 'm3',
            text: 'veja',
            attachments: [
              { type: 'image', payload: { url: 'https://cdn/x.jpg' } },
              { type: 'audio', payload: { url: 'https://cdn/y.mp4' } },
              { type: 'share', payload: { url: 'https://instagram.com/p/1' } },
            ],
          },
        },
      ]),
    )
    const parts = ev.kind === 'message' ? ev.parts : []
    expect(parts.map((p) => [p.id, p.contentType])).toEqual([
      ['m3', 'text'],
      ['m3:a0', 'image'],
      ['m3:a1', 'audio'],
      ['m3:a2', 'text'],
    ])
    expect(parts[3].text).toContain('[share]')
  })

  it('uses the mid for a lone attachment and reads "seen" events', () => {
    const events = normalizeInstagramWebhook(
      wrap([
        {
          sender: { id: PEER },
          recipient: { id: ME },
          timestamp: 5000,
          message: { mid: 'm4', attachments: [{ type: 'video', payload: { url: 'https://cdn/v.mp4' } }] },
        },
        { sender: { id: PEER }, recipient: { id: ME }, timestamp: 6000, read: { mid: 'm9' } },
      ]),
    )
    expect(events[0].kind === 'message' && events[0].parts[0].id).toBe('m4')
    expect(events[1]).toMatchObject({ kind: 'seen', peerId: PEER, timestamp: 6 })
  })

  it('ignores other objects and malformed bodies', () => {
    expect(normalizeInstagramWebhook({ object: 'page', entry: [] })).toEqual([])
    expect(normalizeInstagramWebhook(null)).toEqual([])
    expect(normalizeInstagramWebhook(wrap([{ sender: {}, recipient: {} }]))).toEqual([])
  })
})

describe('sendWindow', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  it('is open for 24 h, then human_agent for 7 days, then closed', () => {
    expect(sendWindow('2026-10-20T01:00:00Z', now)).toBe('open')
    expect(sendWindow('2026-10-18T12:00:00Z', now)).toBe('human_agent')
    expect(sendWindow('2026-10-10T12:00:00Z', now)).toBe('closed')
    expect(sendWindow(null, now)).toBe('closed')
  })
})

describe('verifyInstagramSignature', () => {
  afterEach(() => vi.unstubAllEnvs())
  const body = '{"object":"instagram"}'
  const sign = (secret: string) =>
    'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')

  it('accepts either configured secret and rejects everything else', () => {
    vi.stubEnv('INSTAGRAM_APP_SECRET', 'ig-secret')
    vi.stubEnv('META_APP_SECRET', 'meta-secret')
    expect(verifyInstagramSignature(body, sign('ig-secret'))).toBe(true)
    expect(verifyInstagramSignature(body, sign('meta-secret'))).toBe(true)
    expect(verifyInstagramSignature(body, sign('other'))).toBe(false)
    expect(verifyInstagramSignature(body, null)).toBe(false)
    expect(verifyInstagramSignature(body + ' ', sign('ig-secret'))).toBe(false)
  })

  it('fails closed with no secret configured', () => {
    vi.stubEnv('INSTAGRAM_APP_SECRET', '')
    vi.stubEnv('META_APP_SECRET', '')
    expect(verifyInstagramSignature(body, sign('x'))).toBe(false)
  })
})

describe('OAuth state', () => {
  it('round-trips, and rejects tampering and expiry', () => {
    const s = signOAuthState('acc', 'user', 1_000_000)
    expect(verifyOAuthState(s, 1_000_000 + 60_000)).toEqual({ accountId: 'acc', userId: 'user' })
    expect(verifyOAuthState(s + 'x', 1_000_000)).toBeNull()
    expect(verifyOAuthState(s, 1_000_000 + 11 * 60_000)).toBeNull()
    expect(verifyOAuthState(null)).toBeNull()
  })
})
