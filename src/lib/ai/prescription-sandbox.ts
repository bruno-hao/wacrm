export const MAX_PRESCRIPTION_SANDBOX_IMAGE_BYTES = 8 * 1024 * 1024

export function validatePrescriptionSandboxImage(input: {
  mimeType: string
  size: number
}): { ok: true } | { ok: false; code: 'invalid_image' | 'image_too_large' } {
  if (!input.mimeType.toLowerCase().startsWith('image/')) {
    return { ok: false, code: 'invalid_image' }
  }
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_PRESCRIPTION_SANDBOX_IMAGE_BYTES) {
    return { ok: false, code: 'image_too_large' }
  }
  return { ok: true }
}
