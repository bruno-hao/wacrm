import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { compressAvatar, photoNeedsSync, PHOTO_SIZE } from './contact-photo'

describe('compressAvatar', () => {
  it('shrinks a large photo to a small square WebP', async () => {
    // Noisy 1600×1200 JPEG — a worst case for compression.
    const raw = Buffer.alloc(1600 * 1200 * 3)
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251
    const big = await sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer()

    const out = await compressAvatar(big)
    const meta = await sharp(out).metadata()

    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(PHOTO_SIZE)
    expect(meta.height).toBe(PHOTO_SIZE)
    expect(out.byteLength).toBeLessThan(big.byteLength / 10)
  })
})

describe('photoNeedsSync', () => {
  it('syncs never-synced contacts and stale ones, not fresh ones', () => {
    expect(photoNeedsSync({ avatar_synced_at: null })).toBe(true)
    expect(photoNeedsSync({})).toBe(true)
    expect(photoNeedsSync({ avatar_synced_at: new Date().toISOString() })).toBe(false)
    expect(
      photoNeedsSync({
        avatar_synced_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      }),
    ).toBe(true)
  })
})
