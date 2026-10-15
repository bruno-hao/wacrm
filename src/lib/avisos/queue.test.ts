import { describe, expect, it } from 'vitest'
import { MAX_GAP_MS, MIN_GAP_MS, randomGapMs } from './queue'

describe('randomGapMs', () => {
  it('stays between 5 and 15 seconds', () => {
    expect(randomGapMs(() => 0)).toBe(MIN_GAP_MS)
    expect(randomGapMs(() => 0.9999999)).toBe(MAX_GAP_MS)
    for (let i = 0; i < 200; i++) {
      const gap = randomGapMs()
      expect(gap).toBeGreaterThanOrEqual(5_000)
      expect(gap).toBeLessThanOrEqual(15_000)
    }
  })
})
