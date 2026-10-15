'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';

import type { Message } from '@/types';

// One shared lookup: is the "Transcrever áudio" shortcut enabled?
let enabledPromise: Promise<boolean> | null = null;
function transcriptionEnabled(): Promise<boolean> {
  enabledPromise ??= fetch('/api/ai/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => Boolean(d?.configured && d.transcription_enabled && d.provider !== 'anthropic'))
    .catch(() => false);
  return enabledPromise;
}

/**
 * Under an audio player: the stored transcription (italic), or — when the
 * assistant's transcription is on — a "Transcrever áudio" shortcut that
 * swaps itself for a small animation while the audio is processed and then
 * for the transcribed text.
 */
export function AudioTranscription({ message }: { message: Message }) {
  const t = useTranslations('Inbox.bubble');
  const [text, setText] = useState(message.content_text?.trim() || '');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (text) return;
    let cancelled = false;
    void transcriptionEnabled().then((v) => {
      if (!cancelled) setEnabled(v);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  // A transcription saved elsewhere (another tab) arrives via realtime.
  useEffect(() => {
    if (message.content_text?.trim()) setText(message.content_text.trim());
  }, [message.content_text]);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/ai/transcribe-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: message.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.text) setText(String(data.text));
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (text) {
    return (
      <p className="mt-1 whitespace-pre-wrap break-words text-sm italic">{text}</p>
    );
  }
  if (!message.media_url || !enabled) return null;

  if (busy) {
    return (
      <p
        className="mt-1 flex items-center gap-1.5 text-xs italic opacity-80"
        role="status"
        aria-live="polite"
      >
        <span className="flex gap-0.5" aria-hidden>
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current" />
        </span>
        {t('transcribing')}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
    >
      <FileText className="size-3" />
      {failed ? t('transcribeRetry') : t('transcribeAudio')}
    </button>
  );
}
