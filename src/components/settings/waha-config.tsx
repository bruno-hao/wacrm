'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, QrCode, Smartphone, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface WahaState {
  configured: boolean;
  reachable?: boolean;
  has_server_defaults?: boolean;
  base_url?: string;
  session?: string;
  status?: string;
  me?: { id?: string; pushName?: string } | null;
  send_delay_ms?: number;
  qr?: string | null;
  error?: string;
}

const STATUS_LABEL: Record<string, string> = {
  WORKING: 'Conectado',
  SCAN_QR_CODE: 'Aguardando leitura do QR code',
  STARTING: 'Iniciando…',
  STOPPED: 'Parado',
  FAILED: 'Falhou',
  NOT_CREATED: 'Sessão não criada',
};

function phoneFromMe(id?: string): string {
  return id ? id.split('@')[0] : '';
}

export function WahaConfig() {
  const [state, setState] = useState<WahaState | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [session, setSession] = useState('default');
  const [delaySec, setDelaySec] = useState(4);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (withQr = false) => {
    try {
      const res = await fetch(`/api/whatsapp/waha/config${withQr ? '?qr=1' : ''}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as WahaState;
      setState(data);
      if (data.configured) {
        if (data.base_url) setBaseUrl((v) => v || data.base_url!);
        if (data.session) setSession(data.session);
        if (data.send_delay_ms) setDelaySec(Math.round(data.send_delay_ms / 1000));
      }
    } catch {
      setState({ configured: false, error: 'Falha ao consultar o servidor.' });
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  // While the account is waiting for a QR scan (or the session is still
  // starting), keep polling so the QR refreshes and the screen flips to
  // "Conectado" the moment the phone pairs.
  const needsPolling =
    state?.configured &&
    state.reachable &&
    (state.status === 'SCAN_QR_CODE' || state.status === 'STARTING');
  useEffect(() => {
    if (!needsPolling) return;
    timer.current = setInterval(() => void load(true), 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [needsPolling, load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/waha/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl || undefined,
          api_key: apiKey || undefined,
          session: session || undefined,
          send_delay_ms: delaySec * 1000,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Não foi possível salvar.');
        return;
      }
      setApiKey('');
      toast.success('WAHA configurado. Escaneie o QR code para conectar.');
      await load(true);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Desconectar o WhatsApp via WAHA e remover esta configuração?')) return;
    setRemoving(true);
    try {
      const res = await fetch('/api/whatsapp/waha/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Não foi possível remover.');
        return;
      }
      toast.success('WAHA desconectado.');
      setBaseUrl('');
      await load(true);
    } finally {
      setRemoving(false);
    }
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const connected = state.status === 'WORKING';
  const needsServer = !state.has_server_defaults;

  return (
    <div className="space-y-4">
      {state.configured && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              {connected ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-amber-500" />
              )}
              {state.reachable === false
                ? 'WAHA inacessível'
                : (STATUS_LABEL[state.status ?? ''] ?? state.status)}
            </CardTitle>
            <CardDescription>
              {state.base_url} · sessão {state.session}
              {connected && state.me?.id
                ? ` · número +${phoneFromMe(state.me.id)}${
                    state.me.pushName ? ` (${state.me.pushName})` : ''
                  }`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.error && (
              <Alert variant="destructive">
                <AlertTitle>Erro</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            {state.status === 'SCAN_QR_CODE' && (
              <div className="flex flex-col items-center gap-3">
                {state.qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={state.qr}
                    alt="QR code do WhatsApp"
                    className="h-64 w-64 rounded-md border bg-white p-2"
                  />
                ) : (
                  <div className="flex h-64 w-64 items-center justify-center rounded-md border">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Smartphone className="h-4 w-4" />
                  No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load(true)}>
                <QrCode className="mr-2 h-4 w-4" /> Atualizar status
              </Button>
              <Button variant="destructive" size="sm" onClick={remove} disabled={removing}>
                {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Desconectar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Conexão com o WAHA</CardTitle>
          <CardDescription>
            Conecta o CRM a um número de WhatsApp comum (WhatsApp Web) por meio de um servidor
            WAHA. Não usa templates nem a janela de 24 horas da API oficial.
            {state.has_server_defaults
              ? ' Deixe URL e chave em branco para usar o WAHA padrão deste servidor.'
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="waha-url">URL do WAHA</Label>
            <Input
              id="waha-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={state.has_server_defaults ? 'Padrão do servidor' : 'https://waha.exemplo.com'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="waha-key">API key</Label>
            <Input
              id="waha-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                state.configured
                  ? '•••••••• (deixe em branco para manter)'
                  : state.has_server_defaults
                    ? 'Padrão do servidor'
                    : 'Chave X-Api-Key'
              }
              autoComplete="off"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="waha-session">Sessão</Label>
              <Input
                id="waha-session"
                value={session}
                onChange={(e) => setSession(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                O WAHA gratuito (Core) só aceita a sessão &quot;default&quot;.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="waha-delay">Intervalo entre disparos (segundos)</Label>
              <Input
                id="waha-delay"
                type="number"
                min={2}
                max={120}
                value={delaySec}
                onChange={(e) => setDelaySec(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Pausa mínima entre mensagens de um disparo em massa. Intervalos curtos aumentam
                o risco de bloqueio do número.
              </p>
            </div>
          </div>
          <Button onClick={save} disabled={saving || (needsServer && !baseUrl && !state.configured)}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {state.configured ? 'Salvar e reconectar' : 'Conectar via WAHA'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
