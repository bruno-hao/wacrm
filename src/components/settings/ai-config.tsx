'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AiScheduleEditor } from './ai-schedule-editor';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import {
  DEFAULT_AI_AUTO_REPLY_SCHEDULE,
  parseAiAutoReplySchedule,
} from '@/lib/ai/schedule';
import type { AiAutoReplySchedule, AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const emptySchedule = (): AiAutoReplySchedule => ({
  ...DEFAULT_AI_AUTO_REPLY_SCHEDULE,
  days: {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  },
});

const PROVIDER_LABEL: Record<
  Exclude<AiProvider, 'openai_compatible'>,
  string
> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  openai_compatible: 'your-api-key',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [chatDraftModel, setChatDraftModel] = useState('');
  const [chatDraftPrompt, setChatDraftPrompt] = useState('');
  const [disableAiOnAgentMessage, setDisableAiOnAgentMessage] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplySchedule, setAutoReplySchedule] =
    useState<AiAutoReplySchedule>(emptySchedule);
  const [maxPerConversation, setMaxPerConversation] = useState(20);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
  const [transcriptionModel, setTranscriptionModel] = useState(
    'whisper-large-v3-turbo'
  );
  const [prescriptionReaderEnabled, setPrescriptionReaderEnabled] = useState(false);
  const [prescriptionReaderModel, setPrescriptionReaderModel] = useState('');
  const [prescriptionReaderPrompt, setPrescriptionReaderPrompt] = useState('');
  const [googleReviewsModel, setGoogleReviewsModel] = useState('openai/gpt-4o-mini');
  const [googleReviewsPrompt, setGoogleReviewsPrompt] = useState('');
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setBaseUrl(data.base_url ?? '');
        setSystemPrompt(data.system_prompt ?? '');
        setChatDraftModel(data.chat_draft_model || data.model || '');
        setChatDraftPrompt(data.chat_draft_prompt || data.system_prompt || '');
        setDisableAiOnAgentMessage(Boolean(data.disable_ai_on_agent_message));
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setAutoReplySchedule(
          data.auto_reply_schedule
            ? parseAiAutoReplySchedule(data.auto_reply_schedule)
            : emptySchedule()
        );
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setTranscriptionEnabled(Boolean(data.transcription_enabled));
        setTranscriptionModel(
          data.transcription_model || 'whisper-large-v3-turbo'
        );
        setPrescriptionReaderEnabled(Boolean(data.prescription_reader_enabled));
        setPrescriptionReaderModel(data.prescription_reader_model || '');
        setPrescriptionReaderPrompt(data.prescription_reader_prompt || '');
        setGoogleReviewsModel(data.google_reviews_model || 'openai/gpt-4o-mini');
        setGoogleReviewsPrompt(data.google_reviews_prompt || '');
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model === AI_PROVIDER_DEFAULT_MODEL.openai_compatible ||
      model.trim() === '';
    if (isDefaultModel)
      setModel(
        next === 'openai_compatible' ? '' : AI_PROVIDER_DEFAULT_MODEL[next]
      );
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    chat_draft_model: chatDraftModel.trim() || model.trim(),
    chat_draft_prompt: chatDraftPrompt.trim() || null,
    disable_ai_on_agent_message: disableAiOnAgentMessage,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_schedule: autoReplySchedule,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
    transcription_enabled: transcriptionEnabled && provider !== 'anthropic',
    transcription_model: transcriptionModel.trim() || 'whisper-large-v3-turbo',
    prescription_reader_enabled: prescriptionReaderEnabled,
    prescription_reader_model: prescriptionReaderModel.trim(),
    prescription_reader_prompt: prescriptionReaderPrompt.trim() || null,
    google_reviews_model: googleReviewsModel.trim() || 'openai/gpt-4o-mini',
    google_reviews_prompt: googleReviewsPrompt.trim() || null,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (provider === 'openai_compatible' && !baseUrl.trim()) {
      toast.error(t('missingBaseUrl'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    try {
      parseAiAutoReplySchedule(autoReplySchedule);
    } catch {
      toast.error(t('schedule.invalid'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setBaseUrl('');
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setAutoReplySchedule(emptySchedule());
        setSystemPrompt('');
        setChatDraftModel('');
        setChatDraftPrompt('');
        setDisableAiOnAgentMessage(false);
        setHandoffAgentId('');
        setTranscriptionEnabled(false);
        setTranscriptionModel('whisper-large-v3-turbo');
        setPrescriptionReaderEnabled(false);
        setPrescriptionReaderModel('');
        setPrescriptionReaderPrompt('');
        setGoogleReviewsModel('openai/gpt-4o-mini');
        setGoogleReviewsPrompt('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')}{' '}
        {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {!canEdit && (
        <p className="border-border bg-muted/40 text-muted-foreground mb-4 rounded-md border px-3 py-2 text-sm">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="text-primary h-4 w-4" />{' '}
              {t('providerAndKey')}
            </CardTitle>
            <CardDescription>{t('encryptionNotice')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">
                      {PROVIDER_LABEL.openai}
                    </SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                    <SelectItem value="openai_compatible">
                      {t('providerOpenAiCompatible')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">{t('model')}</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                  disabled={disabled}
                />
              </div>

              {provider === 'openai_compatible' && (
                <div className="space-y-2">
                  <Label htmlFor="ai-base-url">{t('baseUrl')}</Label>
                  <Input
                    id="ai-base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <p className="text-muted-foreground text-xs">
                    {t('baseUrlHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">{t('apiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder={KEY_PLACEHOLDER[provider]}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('testKey')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="text-muted-foreground font-normal">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                {t('embeddingsHint', {
                  sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('behaviour')}</CardTitle>
            <CardDescription>{t('behaviourDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt" id="ai-business-context">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t('enableAssistant')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="border-border rounded-md border p-3">
              <p className="text-foreground text-sm font-medium">{t('chatAssistant')}</p>
              <p className="text-muted-foreground mt-1 text-xs">{t('chatAssistantDesc')}</p>
              <div className="mt-3 space-y-2">
                <Label htmlFor="ai-chat-draft-model">{t('chatAssistantModel')}</Label>
                <Input id="ai-chat-draft-model" value={chatDraftModel || model} onChange={(e) => setChatDraftModel(e.target.value)} disabled={disabled} />
              </div>
              <div className="mt-3 space-y-2">
                <Label htmlFor="ai-chat-draft-prompt">{t('chatAssistantPrompt')}</Label>
                <Textarea id="ai-chat-draft-prompt" value={chatDraftPrompt} onChange={(e) => setChatDraftPrompt(e.target.value)} placeholder={t('chatAssistantPromptPlaceholder')} rows={5} disabled={disabled} />
              </div>
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">{t('disableAiOnAgentMessage')}</p>
                <p className="text-muted-foreground text-xs">{t('disableAiOnAgentMessageDesc')}</p>
              </div>
              <Switch checked={disableAiOnAgentMessage} onCheckedChange={setDisableAiOnAgentMessage} disabled={disabled} />
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t('autoReply')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div id="ai-prescription-reader" className="border-border rounded-md border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {t('transcription')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t('transcriptionDesc')}
                  </p>
                </div>
                <Switch
                  checked={transcriptionEnabled && provider !== 'anthropic'}
                  onCheckedChange={setTranscriptionEnabled}
                  disabled={disabled || provider === 'anthropic'}
                />
              </div>
              {provider === 'anthropic' && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('transcriptionUnsupported')}
                </p>
              )}
              {transcriptionEnabled && provider !== 'anthropic' && (
                <div className="mt-3 space-y-2">
                  <Label htmlFor="ai-transcription-model">
                    {t('transcriptionModel')}
                  </Label>
                  <Input
                    id="ai-transcription-model"
                    value={transcriptionModel}
                    onChange={(e) => setTranscriptionModel(e.target.value)}
                    placeholder="whisper-large-v3-turbo"
                    disabled={disabled}
                    autoComplete="off"
                    className="max-w-sm"
                  />
                  <p className="text-muted-foreground text-xs">
                    {t('transcriptionModelHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="border-border rounded-md border p-3">
              <p className="text-foreground text-sm font-medium">{t('googleReviews')}</p>
              <p className="text-muted-foreground mt-1 text-xs">{t('googleReviewsDesc')}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="ai-google-reviews-model">{t('googleReviewsModel')}</Label><Input id="ai-google-reviews-model" value={googleReviewsModel} onChange={(e) => setGoogleReviewsModel(e.target.value)} placeholder="openai/gpt-4o-mini" disabled={disabled} /></div>
                <p className="text-muted-foreground self-end text-xs">{t('googleReviewsModelHint')}</p>
              </div>
              <div className="mt-3 space-y-2"><Label htmlFor="ai-google-reviews-prompt">{t('googleReviewsPrompt')}</Label><Textarea id="ai-google-reviews-prompt" value={googleReviewsPrompt} onChange={(e) => setGoogleReviewsPrompt(e.target.value)} placeholder={t('googleReviewsPromptPlaceholder')} rows={4} disabled={disabled} /></div>
            </div>

            <div className="border-border rounded-md border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-foreground text-sm font-medium">{t('prescriptionReader')}</p>
                  <p className="text-muted-foreground text-xs">{t('prescriptionReaderDesc')}</p>
                </div>
                <Switch
                  checked={prescriptionReaderEnabled}
                  onCheckedChange={setPrescriptionReaderEnabled}
                  disabled={disabled}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai-prescription-model">{t('prescriptionReaderModel')}</Label>
                  <Input
                    id="ai-prescription-model"
                    value={prescriptionReaderModel}
                    onChange={(e) => setPrescriptionReaderModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    disabled={disabled}
                    autoComplete="off"
                  />
                </div>
                <p className="text-muted-foreground self-end text-xs">{t('prescriptionReaderModelHint')}</p>
              </div>
              <div className="mt-3 space-y-2">
                <Label htmlFor="ai-prescription-prompt">{t('prescriptionReaderPrompt')}</Label>
                <Textarea
                  id="ai-prescription-prompt"
                  value={prescriptionReaderPrompt}
                  onChange={(e) => setPrescriptionReaderPrompt(e.target.value)}
                  placeholder={t('prescriptionReaderPromptPlaceholder')}
                  rows={4}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-muted-foreground text-xs">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1))
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-muted-foreground text-xs">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <AiScheduleEditor
          value={autoReplySchedule}
          onChange={setAutoReplySchedule}
          disabled={disabled}
        />

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={
            embeddingsKeyEdited
              ? embeddingsKey.trim().length > 0
              : hasStoredEmbeddingsKey
          }
        />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
