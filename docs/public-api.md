# API pública (`/api/v1`)

A API pública permite controlar a sua instância do wacrm a partir dos seus
próprios scripts e automações — enviar mensagens, gerenciar contatos,
iniciar disparos em massa — sem passar pela interface do dashboard.

> **Status:** estável. Autenticação, escopos, limite de taxa, os endpoints
> de mensagens / contatos / conversas / disparos e os [webhooks](#webhooks)
> de eventos de saída já estão disponíveis.

## Autenticação

Toda requisição se autentica com uma **chave de API**, enviada como bearer
token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

As chaves têm **escopo de conta**: uma chave atua em exatamente uma conta,
aquela em que foi criada. Não há acesso entre contas.

### Criando uma chave

No dashboard: **Configurações → Chaves de API → Nova chave de API**.
Somente **admins e owners** podem criar chaves.

1. Dê um nome à chave (o da integração que vai usá-la).
2. Conceda os **escopos** de que ela precisa — nada além disso (veja abaixo).
3. Copie a chave. **A chave completa é exibida exatamente uma vez.** O
   wacrm armazena apenas um hash SHA-256, então ela nunca poderá ser
   mostrada de novo. Se você a perder, revogue-a e crie uma nova.

### Revogando uma chave

**Configurações → Chaves de API → Revogar.** A revogação vale a partir da
próxima requisição da chave. As chaves revogadas continuam na lista como
trilha de auditoria.

## Escopos

Uma chave só pode fazer o que seus escopos permitem — independentemente de
quem a criou. Conceda o mínimo.

| Escopo               | Permite                                         |
| -------------------- | ----------------------------------------------- |
| `messages:send`      | Enviar mensagens de WhatsApp                    |
| `messages:read`      | Ler mensagens e status de entrega               |
| `contacts:read`      | Listar e ler contatos                           |
| `contacts:write`     | Criar e atualizar contatos                      |
| `conversations:read` | Listar e ler conversas                          |
| `broadcasts:send`    | Iniciar campanhas de disparo em massa           |
| `webhooks:manage`    | Registrar e gerenciar webhooks de saída         |

Uma chave **sem escopos** ainda se autentica e pode chamar
`GET /api/v1/me` — útil para verificar se uma chave funciona.

## Envelope de resposta

Toda resposta usa um de dois formatos:

```jsonc
// sucesso
{ "data": { /* ... */ } }

// falha
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }
```

Faça a ramificação por `error.code` (estável); `error.message` é para
humanos e pode ser reescrita.

| Status | `code`         | Significado                                                        |
| ------ | -------------- | ------------------------------------------------------------------ |
| 401    | `unauthorized` | Chave ausente / malformada / desconhecida / revogada / expirada    |
| 403    | `forbidden`    | Chave válida, mas sem o escopo necessário                          |
| 429    | `rate_limited` | Limite de taxa por chave excedido                                  |
| 400    | `bad_request`  | Entrada malformada                                                 |
| 404    | `not_found`    | Recurso inexistente                                                |
| 500    | `internal`     | Erro do servidor                                                   |

## Limites de taxa

As requisições são limitadas **por chave**: **120 requisições por minuto**.
Em um `429`, estes headers informam quando tentar de novo:

- `Retry-After` — segundos até a janela reiniciar
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

> O limitador fica em memória e é **por processo**. Uma implantação com
> instância única (o caso comum de um fork self-hosted) funciona como está.
> Se você escalar para várias instâncias, troque o limitador por um
> armazenamento compartilhado (Redis/Upstash) — veja a nota no topo de
> `src/lib/rate-limit.ts`. Caso contrário, o limite não é aplicado entre
> instâncias.

## Endpoints

### `GET /api/v1/me`

Retorna a conta à qual a chave está vinculada e os escopos que ela possui.
Exige apenas uma chave válida (nenhum escopo). Use-o para verificar se uma
chave funciona e para descobrir seus escopos.

```bash
curl https://your-crm.example.com/api/v1/me \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "data": {
    "account": { "id": "…", "name": "Acme Inc" },
    "key": { "id": "…", "scopes": ["messages:send"] }
  }
}
```

### `POST /api/v1/messages`

Envia uma mensagem de WhatsApp para um número de telefone. Escopo:
`messages:send`. Você informa um **número E.164**, não um id interno — o
endpoint localiza ou cria o contato + a conversa e então envia.

`to` deve começar com `+` seguido do código do país (`+14155550123`;
espaços, hífens e parênteses entre os dígitos são aceitos). Um número sem o
`+` é rejeitado com `400 bad_request` mesmo quando os dígitos estão certos:
a API não consegue distinguir `14155550123` (EUA, com código do país) de
`4155551212` (um número nacional dos EUA que a Meta entregaria ao +41,
Suíça), então não adivinha.

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Olá 👋" }'
```

`type` é `text` (padrão), `template` ou um tipo de mídia (`image` /
`video` / `document` / `audio`). Mídia exige `media_url` (e `filename`
opcional); `text` serve também como legenda. `template` exige um objeto
`template`:

```jsonc
{
  "to": "+14155550123",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en_US",
    "params": ["A123"]        // variáveis posicionais do corpo, ou um objeto estruturado
  },
  "reply_to_message_id": "<uuid>"   // opcional; deve estar na mesma conversa
}
```

Resposta (201):

```json
{
  "data": {
    "message_id": "…",
    "whatsapp_message_id": "wamid.…",
    "conversation_id": "…",
    "contact_id": "…",
    "contact_created": true
  }
}
```

Códigos de erro de domínio além dos da tabela acima:
`whatsapp_not_configured` (400), `meta_error` (502 — a requisição chegou à
Meta e ela rejeitou o envio), `template_malformed` (500).

### `GET /api/v1/contacts`

Lista contatos, do mais novo para o mais antigo. Escopo: `contacts:read`.
Paginado (veja [Paginação](#paginação)). Filtros opcionais: `?search=`
(compara com nome ou telefone) e `?tag=<tagId>`.

```json
{
  "data": [
    {
      "id": "…", "phone": "+14155550123", "name": "Jane Doe",
      "email": null, "company": "Acme", "avatar_url": null,
      "tags": [{ "id": "…", "name": "vip", "color": "#3b82f6" }],
      "created_at": "…", "updated_at": "…"
    }
  ],
  "meta": { "next_cursor": "…" }
}
```

### `POST /api/v1/contacts`

Cria um contato. Escopo: `contacts:write`. `phone` (E.164, `+` inicial e
código do país obrigatórios — mesma regra do `POST /api/v1/messages`) é
obrigatório; `name`, `email`, `company` e `tags` (um array de nomes de tag,
criadas se não existirem) são opcionais. **Localizar ou criar por
telefone:** uma correspondência existente retorna `200` com o contato
existente; um contato novo retorna `201`. O corpo da resposta é o contato
serializado (mesmo formato das linhas da listagem acima).

### `GET` / `PATCH /api/v1/contacts/{id}`

Lê ou atualiza um contato. Escopos: `contacts:read` / `contacts:write`.
O `PATCH` atualiza apenas os campos enviados (`name`, `email`, `company`);
passe `tags` (um array de nomes de tag) para substituir as tags do contato.
Um contato de outra conta retorna `404`.

### `GET /api/v1/conversations`

Lista conversas, da mais nova para a mais antiga. Escopo:
`conversations:read`. Paginado. Filtros opcionais: `?status=` (`open` /
`pending` / `closed`) e `?contact_id=`. Cada conversa traz embutidos o seu
contato + tags.

### `GET /api/v1/conversations/{id}`

Lê uma conversa. Escopo: `conversations:read`. `404` se ela pertencer a
outra conta.

### `GET /api/v1/conversations/{id}/messages`

Lista as mensagens de uma conversa, da mais nova para a mais antiga.
Escopo: `messages:read`. Paginado. Cada mensagem inclui `direction`
(`inbound` / `outbound`), `status` (estado de entrega),
`whatsapp_message_id` e `content_*`. Primeiro se verifica que a conversa
pertence à sua conta (`404` caso contrário).

### `POST /api/v1/broadcasts`

Inicia um disparo de template para uma lista de destinatários. Escopo:
`broadcasts:send`. O disparo e suas linhas de destinatários são persistidos
imediatamente e os envios se distribuem em segundo plano, então a chamada
retorna rápido — consulte `GET /api/v1/broadcasts/{id}` para acompanhar o
progresso.

```bash
curl -X POST https://your-crm.example.com/api/v1/broadcasts \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Promoção de julho",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

Os destinatários são limitados a **1000 por requisição** — divida envios
maiores. Números de telefone inválidos — incluindo qualquer um sem `+`
inicial e código do país — são descartados e contados como `rejected`; se
nenhum for válido, a requisição falha com `400 bad_request`. Resposta (202):

```json
{
  "data": {
    "broadcast_id": "…",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}
```

### `GET /api/v1/broadcasts/{id}`

Status do disparo + contagens. Escopo: `broadcasts:send`. O `status` passa
de `sending` → `sent`; `delivered_count` / `read_count` continuam subindo à
medida que chegam os webhooks de entrega da Meta. `404` para o disparo de
outra conta.

## Paginação

Todo endpoint de listagem pagina do mesmo jeito. Peça um tamanho de página
com `?limit=` (padrão 50, máximo 100) e leia a próxima página com o
`meta.next_cursor` opaco da resposta anterior:

```
GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }

GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // última página
```

Os cursores são baseados em keyset (estáveis diante de inserções
concorrentes). Devolva o cursor exatamente como veio — não o interprete.
`next_cursor: null` significa a última página.

## Webhooks

Em vez de fazer polling, registre um endpoint e o wacrm fará um POST nele
quando coisas acontecerem na sua conta. **Migration necessária:** aplique
`supabase/migrations/028_webhook_endpoints.sql`.

### Eventos

| Evento                   | Dispara quando                                         |
| ------------------------ | ------------------------------------------------------ |
| `message.received`       | Uma mensagem de entrada chega de um contato            |
| `message.status_updated` | Uma mensagem que você enviou mudou de status de entrega |
| `conversation.created`   | Uma nova conversa é aberta para um contato             |

### Gerenciando endpoints

Tudo sob o escopo `webhooks:manage`.

- `POST /api/v1/webhooks` — registra `{ "url": "https://…", "events": ["message.received"] }`. A `url` deve ser `https://`. **A resposta inclui `secret` exatamente uma vez** — guarde-o para verificar assinaturas; o wacrm mantém apenas uma cópia criptografada.
- `GET /api/v1/webhooks` — lista seus endpoints (nunca retorna o segredo).
- `GET /api/v1/webhooks/{id}` — lê um.
- `PATCH /api/v1/webhooks/{id}` — atualiza `url`, `events` ou `is_active` (reativar zera o contador de falhas).
- `DELETE /api/v1/webhooks/{id}` — remove um.

```bash
curl -X POST https://your-crm.example.com/api/v1/webhooks \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/hooks/wacrm", "events": ["message.received"] }'
# → 201 { "data": { "id": "…", "url": "…", "events": [...], "secret": "whsec_…" } }
```

### Payload de entrega

Toda entrega é um POST com este envelope; `id` é um uuid único por entrega
que você pode usar para deduplicar, e `data` varia conforme o `event`:

```json
{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* por evento, veja abaixo */ }
}
```

`data` por evento:

```jsonc
// message.received
{ "conversation_id": "…", "contact_id": "…", "whatsapp_message_id": "wamid.…", "content_type": "text", "text": "Olá 👋" }
// conversation.created
{ "conversation_id": "…", "contact_id": "…" }
// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered" }
```

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id` e `X-Wacrm-Signature`.

### Verificando a assinatura

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` onde `v1 =
HMAC-SHA256(secret, "${t}.${rawBody}")`. Recalcule-a sobre o **corpo bruto
da requisição** e compare em tempo constante; rejeite se `t` tiver mais de
alguns minutos (proteção contra replay).

```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
```

### Semântica de entrega

A entrega é de **melhor esforço**: uma única tentativa por evento com um
timeout curto, e **redirecionamentos não são seguidos**.
`message.status_updated` cobre as mensagens que o wacrm armazena (inbox +
envios pela API), não os envios exclusivos de disparos em massa, e — como
os provedores reenviam e reordenam callbacks de status — o mesmo status
pode chegar mais de uma vez ou fora de ordem; **deduplique por `id` e não
presuma ordenação**. Cada falha consecutiva incrementa `failure_count`;
após falhas consecutivas suficientes o endpoint é desativado
automaticamente (`is_active: false`) — reative-o com `PATCH` (que zera o
contador). Retentativa durável com backoff (uma fila de entrega) é uma
melhoria futura; hoje, considere que entregas perdidas são possíveis e
reconcilie com os endpoints de leitura quando isso importar.

**Restrições de destino (SSRF).** A `url` deve ser `https://` e resolver
para um endereço público — requisições para `localhost`, faixas
privadas/RFC1918, link-local (incluindo o metadata de nuvem
`169.254.169.254`) e destinos internos semelhantes são recusadas no momento
da entrega.

## Roadmap

A API pública agora cobre mensagens, contatos, conversas, disparos em massa
e webhooks de saída — o escopo completo da
[#245](https://github.com/ArnasDon/wacrm/issues/245). Ideias futuras
(negócios/funis, templates, fluxos, uma fila de entrega para webhooks) ainda
não estão agendadas.
