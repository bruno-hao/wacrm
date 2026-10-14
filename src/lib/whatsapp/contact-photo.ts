/**
 * Contact profile photos (WAHA provider).
 *
 * WhatsApp serves photos as large JPEGs on a short-lived CDN URL. We
 * download one, shrink it to a 128×128 WebP (~3–6 KB — roughly 20× smaller
 * than the original), store it in the public `avatars` bucket and point
 * `contacts.avatar_url` at it. Each contact is attempted once, then
 * refreshed at most every REFRESH_DAYS (people change photos rarely).
 */

import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  wahaGetProfilePictureUrl,
  type WahaCreds,
} from '@/lib/whatsapp/waha-api'

export const PHOTO_SIZE = 128
const PHOTO_QUALITY = 60
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
const REFRESH_DAYS = 30

export const AVATAR_BUCKET = 'avatars'

/** Resize + re-encode any common image into the compact stored format. */
export async function compressAvatar(input: Uint8Array): Promise<Buffer> {
  return sharp(input, { failOn: 'none' })
    .rotate() // honour EXIF orientation before it is stripped
    .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'attention' })
    .webp({ quality: PHOTO_QUALITY, effort: 6 })
    .toBuffer()
}

export function photoNeedsSync(contact: {
  avatar_synced_at?: string | null
}): boolean {
  if (!contact.avatar_synced_at) return true
  const age = Date.now() - new Date(contact.avatar_synced_at).getTime()
  return age > REFRESH_DAYS * 24 * 60 * 60 * 1000
}

export type PhotoSyncResult = 'updated' | 'no_photo' | 'failed'

/**
 * Fetch, compress and store one contact's photo. Never throws — a photo
 * is cosmetic and must not break message handling. Stamps
 * `avatar_synced_at` on success and on "no photo" so we don't retry
 * immediately; a transient failure leaves it unset so it is retried.
 */
export async function syncContactPhoto(args: {
  db: SupabaseClient
  creds: WahaCreds
  accountId: string
  contactId: string
  phone: string
}): Promise<PhotoSyncResult> {
  const { db, creds, accountId, contactId, phone } = args
  try {
    const url = await wahaGetProfilePictureUrl(creds, phone)
    const stamp = { avatar_synced_at: new Date().toISOString() }

    if (!url) {
      await db.from('contacts').update(stamp).eq('id', contactId)
      return 'no_photo'
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return 'failed'
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD_BYTES) {
      return 'failed'
    }

    const webp = await compressAvatar(bytes)
    const path = `contacts/${accountId}/${contactId}.webp`
    const { error: upErr } = await db.storage
      .from(AVATAR_BUCKET)
      .upload(path, webp, {
        contentType: 'image/webp',
        cacheControl: '2592000',
        upsert: true,
      })
    if (upErr) {
      console.warn('[contact-photo] upload failed:', upErr.message)
      return 'failed'
    }

    const {
      data: { publicUrl },
    } = db.storage.from(AVATAR_BUCKET).getPublicUrl(path)
    // Versioned URL: the object path is stable, so bust the CDN/browser
    // cache when the photo changes.
    const { error } = await db
      .from('contacts')
      .update({ avatar_url: `${publicUrl}?v=${Date.now()}`, ...stamp })
      .eq('id', contactId)
    return error ? 'failed' : 'updated'
  } catch (err) {
    console.warn(
      '[contact-photo] sync failed:',
      err instanceof Error ? err.message : err,
    )
    return 'failed'
  }
}
