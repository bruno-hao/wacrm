import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { validateAiCredentials } from '@/lib/ai/validate';
import { embedTexts } from '@/lib/ai/embeddings';
import { AiError, type AiProvider } from '@/lib/ai/types';
import { normalizeOpenAiCompatibleBaseUrl } from '@/lib/ai/providers/openai-compatible';
import {
  readAutoReplyScheduleUpdate,
  readStoredAutoReplySchedule,
} from '@/lib/ai/config-payload';
import { DEFAULT_AI_AUTO_REPLY_SCHEDULE } from '@/lib/ai/schedule';
import { getT } from '@/lib/i18n/translate';
import { DEFAULT_MARIA_SYSTEM_PROMPT } from '@/lib/ai/maria-prompt';

const t = getT('Api');

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('ai_configs')
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        'provider, model, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, auto_reply_schedule, handoff_agent_id, api_key, embeddings_api_key, transcription_enabled, transcription_model, prescription_reader_enabled, prescription_reader_model, prescription_reader_prompt'
      )
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      console.error('[ai/config GET] fetch error:', error);
      return NextResponse.json(
        { error: t('ai.loadConfigFailed') },
        { status: 500 }
      );
    }

    if (!data) return NextResponse.json({ configured: false });
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, auto_reply_schedule, ...safe } = data;
    const safeSchedule = readStoredAutoReplySchedule(
      auto_reply_schedule,
      (err) =>
        console.error(
          `[ai/config GET] invalid auto-reply schedule for account ${accountId}; returning fail-closed value.`,
          err
        )
    );
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
      system_prompt: safe.system_prompt || DEFAULT_MARIA_SYSTEM_PROMPT,
      auto_reply_schedule: safeSchedule,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(
      `ai-config:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return bad(t('common.invalidRequestBody'));

    const provider = body.provider as AiProvider;
    if (
      provider !== 'openai' &&
      provider !== 'anthropic' &&
      provider !== 'openai_compatible'
    ) {
      return bad(t('ai.providerInvalid'));
    }
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) return bad(t('ai.modelRequired'));

    const baseUrlProvided = 'base_url' in body;
    const requestedBaseUrl =
      typeof body.base_url === 'string' ? body.base_url.trim() : '';

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null;
    const systemPromptProvided = 'system_prompt' in body;
    const isActive = body.is_active === true;
    const autoReplyEnabled = body.auto_reply_enabled === true;
    let scheduleUpdate: ReturnType<typeof readAutoReplyScheduleUpdate>;
    try {
      scheduleUpdate = readAutoReplyScheduleUpdate(
        body as Record<string, unknown>
      );
    } catch {
      return bad(t('ai.scheduleInvalid'));
    }

    let maxPer = Number(body.auto_reply_max_per_conversation);
    if (!Number.isFinite(maxPer)) maxPer = 20;
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)));

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string'
        ? body.handoff_agent_id.trim()
        : '';
    const handoffProvided = 'handoff_agent_id' in body;
    let handoffAgentId: string | null = null;
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle();
      if (!member) return bad(t('ai.handoffNotMember'));
      handoffAgentId = rawHandoff;
    }

    // Voice-note transcription (reuses this provider's base URL + key).
    // Absent → left unchanged on update; the form always sends both.
    const transcriptionProvided = 'transcription_enabled' in body;
    const transcriptionEnabled = body.transcription_enabled === true;
    const transcriptionModel =
      typeof body.transcription_model === 'string' &&
      body.transcription_model.trim()
        ? body.transcription_model.trim().slice(0, 120)
        : 'whisper-large-v3-turbo';
    if (transcriptionEnabled && provider === 'anthropic') {
      return bad(t('ai.transcriptionUnsupported'));
    }

    const prescriptionReaderProvided =
      'prescription_reader_enabled' in body ||
      'prescription_reader_model' in body ||
      'prescription_reader_prompt' in body;
    const prescriptionReaderEnabled =
      'prescription_reader_enabled' in body
        ? body.prescription_reader_enabled === true
        : false;
    const prescriptionReaderModel =
      typeof body.prescription_reader_model === 'string'
        ? body.prescription_reader_model.trim().slice(0, 120)
        : '';
    const prescriptionReaderPrompt =
      typeof body.prescription_reader_prompt === 'string' &&
      body.prescription_reader_prompt.trim()
        ? body.prescription_reader_prompt.trim().slice(0, 20_000)
        : null;
    const { data: existingReader } = await supabase
      .from('ai_configs')
      .select('prescription_reader_enabled, prescription_reader_model, prescription_reader_prompt')
      .eq('account_id', accountId)
      .maybeSingle();
    const effectiveReaderEnabled =
      'prescription_reader_enabled' in body
        ? prescriptionReaderEnabled
        : Boolean(existingReader?.prescription_reader_enabled);
    const effectiveReaderModel =
      'prescription_reader_model' in body
        ? prescriptionReaderModel
        : existingReader?.prescription_reader_model ?? '';
    if (effectiveReaderEnabled && !effectiveReaderModel) {
      return bad(t('ai.prescriptionReaderModelRequired'));
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : '';
    const clearEmbeddingsKey = body.embeddings_api_key === null;

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, base_url, api_key, system_prompt, prescription_reader_enabled, prescription_reader_model, prescription_reader_prompt')
      .eq('account_id', accountId)
      .maybeSingle();

    let apiKeyPlain: string;
    let baseUrl: string | null = null;
    if (provider === 'openai_compatible') {
      const candidate = baseUrlProvided
        ? requestedBaseUrl
        : existing?.provider === 'openai_compatible'
          ? (existing.base_url ?? '').trim()
          : '';
      if (!candidate) return bad(t('ai.baseUrlRequired'));
      try {
        normalizeOpenAiCompatibleBaseUrl(candidate);
      } catch (err) {
        return bad(
          err instanceof AiError ? err.message : t('ai.baseUrlInvalid')
        );
      }
      baseUrl = candidate;
    }
    if (rawKey) {
      apiKeyPlain = rawKey;
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key);
      } catch {
        return bad(t('ai.storedKeyReenter'));
      }
    } else {
      return bad(t('ai.apiKeyRequired'));
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model ||
      baseUrl !== (existing.base_url ?? null);

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          baseUrl,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          autoReplySchedule: scheduleUpdate.provided
            ? scheduleUpdate.value
            : DEFAULT_AI_AUTO_REPLY_SCHEDULE,
          handoffAgentId: null,
          embeddingsApiKey: null,
          transcriptionEnabled: false,
          transcriptionModel: 'whisper-large-v3-turbo',
        });
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 }
          );
        }
        console.error('[ai/config POST] validation error:', err);
        return bad(t('ai.validateWithProviderFailed'));
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping']);
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            {
              error: t('ai.embeddingsKeyError', { message: err.message }),
              code: err.code,
            },
            { status: 400 }
          );
        }
        console.error('[ai/config POST] embeddings validation error:', err);
        return bad(t('ai.validateEmbeddingsFailed'));
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null;
    const shared: Record<string, unknown> = {
      provider,
      model,
      base_url: baseUrl,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    };
    if (systemPromptProvided || !existing) {
      shared.system_prompt = systemPrompt || DEFAULT_MARIA_SYSTEM_PROMPT;
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId;
    if (scheduleUpdate.provided) {
      shared.auto_reply_schedule = scheduleUpdate.value;
    }
    if (transcriptionProvided) {
      shared.transcription_enabled = transcriptionEnabled;
      shared.transcription_model = transcriptionModel;
    }
    if (prescriptionReaderProvided) {
      shared.prescription_reader_enabled =
        'prescription_reader_enabled' in body
          ? prescriptionReaderEnabled
          : Boolean(existing?.prescription_reader_enabled);
      shared.prescription_reader_model =
        'prescription_reader_model' in body
          ? prescriptionReaderModel
          : existing?.prescription_reader_model ?? '';
      shared.prescription_reader_prompt =
        'prescription_reader_prompt' in body
          ? prescriptionReaderPrompt
          : existing?.prescription_reader_prompt ?? null;
    }
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey);
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null;
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_configs')
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq('account_id', accountId);
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr);
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 }
        );
      }
    } else {
      const { error: insErr } = await supabase.from('ai_configs').insert({
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      });
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr);
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId);
    if (error) {
      console.error('[ai/config DELETE] error:', error);
      return NextResponse.json(
        { error: t('ai.deleteConfigFailed') },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
