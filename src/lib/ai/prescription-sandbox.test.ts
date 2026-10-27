import { describe, expect, it } from 'vitest'
import { validatePrescriptionSandboxImage } from './prescription-sandbox'

describe('prescription sandbox image validation', () => {
  it('accepts an image within the ephemeral upload limit', () => {
    expect(validatePrescriptionSandboxImage({ mimeType: 'image/jpeg', size: 1024 })).toEqual({ ok: true })
  })

  it('rejects non-images and oversized uploads before any model call', () => {
    expect(validatePrescriptionSandboxImage({ mimeType: 'application/pdf', size: 1024 })).toMatchObject({ ok: false, code: 'invalid_image' })
    expect(validatePrescriptionSandboxImage({ mimeType: 'image/png', size: 8 * 1024 * 1024 + 1 })).toMatchObject({ ok: false, code: 'image_too_large' })
  })
})
