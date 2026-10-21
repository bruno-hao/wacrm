# Solução de problemas na conexão do WhatsApp

Configurações → Conexão do WhatsApp conversa com a Graph API da Meta em
uma ordem fixa quando você clica em **Salvar configuração**. Quando uma
dessas chamadas falha, o wacrm agora diz *qual* chamada falhou, *qual
campo* conferir, e fornece o código de erro da Meta e o trace id para citar
ao suporte da Meta (issue #505). Esta página lista as causas comuns e o
texto exato que o wacrm mostra para cada uma.

## O que o Salvar configuração faz

| Etapa (mostrada nos detalhes do erro) | Chamada à Meta | Comprova |
| --- | --- | --- |
| *(antes de qualquer chamada à Meta)* | — | Phone Number ID e WABA ID são strings de dígitos |
| `verify_number` | `GET /{phone_number_id}` | o token consegue ler o número |
| `waba_phone_numbers` | `GET /{waba_id}/phone_numbers` | o número realmente pertence àquele WABA |
| `register` | `POST /{phone_number_id}/register` (somente quando um PIN é informado) | o número está registrado na Cloud API para receber webhooks |
| `subscribe_waba` | `POST /{waba_id}/subscribed_apps` | o WABA está inscrito no seu App da Meta, para que os webhooks sejam entregues |

As quatro primeiras falhas interrompem o salvamento; nada é gravado até que
a causa seja corrigida. Uma falha em `register` ainda salva as credenciais
(para que você tente de novo apenas com o PIN) e mostra o motivo no banner
de *Status do registro*.

**Testar conexão da API** reexecuta o `verify_number` com o token
armazenado e, quando há um WABA ID registrado, lê
`GET /{waba_id}/subscribed_apps` e informa se o WABA está inscrito em um
app. Credenciais válidas com um WABA não inscrito é exatamente o estado
"conectado, mas nenhuma mensagem chega".

## Lendo os detalhes do erro

Sob a mensagem acionável, um texto pequeno e discreto mostra:

```
Etapa: verify_number · Código de erro da Meta: 190/463 · Trace ID: AbCdEf...
A Meta disse: Error validating access token: Session has expired ...
```

* **Etapa** — a linha da tabela acima.
* **Código de erro da Meta** — `code/subcode` do envelope da Meta. A
  [referência de códigos de erro da Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)
  documenta todos os valores.
* **Trace ID** — o `fbtrace_id` da Meta. O suporte da Meta consegue
  localizar a requisição com ele; informe-o junto com o código.

O status HTTP também indica quem precisa agir: **400** significa que a
correção está no formulário de configurações (token, ids, PIN); **502**
significa que a Meta precisa mudar algo (limite de taxa, restrição,
indisponibilidade).

## Causas comuns e o que o wacrm mostra

### Phone Number ID não é um id

*Causa:* o número de telefone (`+1 555 ...`) ou um nome de exibição foi
colado no lugar do id numérico.

> O Phone Number ID deve conter apenas dígitos — é o id numérico exibido em
> Meta → WhatsApp → API Setup, e não o número de telefone em si.

A mesma verificação roda para o WABA ID:

> O ID da conta do WhatsApp Business deve conter apenas dígitos — copie-o
> de Meta → WhatsApp → API Setup.

### Token de acesso expirado ou inválido (código 190)

*Causa:* foi usado o token temporário de 24 horas da página API Setup, ou
um token de System User foi revogado / redefinido.

> O token de acesso expirou. Os tokens temporários da página API Setup
> expiram após 24 horas. Gere um token permanente em Meta Business
> Settings → System Users → Generate token, com as permissões
> whatsapp_business_management e whatsapp_business_messaging, e cole-o em
> Token de acesso permanente.

(A primeira frase varia conforme o subcódigo: "foi invalidado" para
460/467, "A Meta rejeitou o token de acesso como inválido" nos demais.)

### Token sem permissões (código 10, 200–299)

*Causa:* o token do System User foi gerado sem
`whatsapp_business_management` / `whatsapp_business_messaging`, ou o System
User nunca foi atribuído ao WABA.

> O token de acesso não tem permissão para executar esta ação (inscrever a
> conta do WhatsApp Business no app). O System User dele precisa das
> permissões whatsapp_business_management e whatsapp_business_messaging E
> deve estar atribuído a esta conta do WhatsApp Business (Business Settings
> → System Users → Add assets → WhatsApp accounts). Depois gere um novo
> token.

O código 131005 (acesso negado) recebe uma mensagem parecida, citando o id
que foi recusado.

### Phone Number ID ou WABA ID errado (código 100 "Unsupported get request", código 33)

*Causa:* o id foi digitado errado, ou pertence a um portfólio empresarial
(Business) diferente daquele em que o token foi gerado.

> A Meta não encontra o Phone Number ID 1234567890, ou a empresa dona do
> token de acesso não é dona dele. Copie o Phone Number ID exatamente de
> Meta → WhatsApp → API Setup e confira se o token foi gerado dentro do
> mesmo portfólio empresarial.

Quando a etapa que falhou é do escopo do WABA, a mensagem cita o *ID da
conta do WhatsApp Business*.

### Número pertence a outro WABA

*Causa:* ambos os ids são válidos, mas o WABA digitado não é dono do
número. Antes da #505 isso salvava normalmente e inscrevia o WABA errado —
o webhook simplesmente nunca disparava.

> O Phone Number ID 111 não pertence à conta do WhatsApp Business 999. A
> Meta lista estes números nela: +1 555-0100 (222), +1 555-0200 (333).
> Confira os dois valores em Meta → WhatsApp → API Setup: o WABA ID exibido
> lá deve ser o que lista este número de telefone.

### Número não registrado na Cloud API (código 133010)

> Este número de telefone ainda não está registrado na WhatsApp Cloud API.
> Informe abaixo o PIN da verificação em duas etapas e salve novamente para
> que o wacrm possa registrá-lo (POST /register).

### PIN de duas etapas incorreto (códigos 133005, 136025)

> O PIN da verificação em duas etapas está incorreto. Use o PIN de 6
> dígitos definido em WhatsApp Manager → Phone numbers → Two-step
> verification (ou redefina-o lá) e salve novamente.

Muitas tentativas erradas (133008 / 133009) bloqueiam novas tentativas por
um tempo:

> A Meta bloqueou temporariamente as tentativas de PIN para este número
> após muitos palpites errados. Aguarde um pouco antes de salvar novamente
> com o PIN correto.

### Conta restrita pela Meta (código 131031, 368)

Nada no wacrm resolve isso — é um estado de política ou de verificação da
Meta.

> A Meta restringiu ou bloqueou esta conta do WhatsApp Business, então
> nada no wacrm consegue conectá-la. Abra o Meta Business Manager →
> Qualidade da conta (ou WhatsApp Manager → Visão geral) para ver a
> restrição e contestá-la.

### Limite de taxa (códigos 4, 17, 32, 613, 80007, 130429, …)

> A Meta está limitando a taxa deste app ou desta conta do WhatsApp
> Business neste momento. Nada precisa ser alterado — aguarde alguns
> minutos e tente de novo.

### Falha temporária do lado da Meta (códigos 1, 2, 131000, 133004, 133016)

> A Meta retornou um erro temporário ao ler o número de telefone (código
> 131000). Tente novamente em um minuto; se continuar acontecendo, confira
> metastatus.com e informe o trace id ao suporte da Meta.

### Qualquer outro caso

Códigos desconhecidos mantêm as palavras da própria Meta mais o trace id:

> A Meta retornou um erro ao registrar o número de telefone (código
> 12345/6): <mensagem da Meta>. Trace id AbCdEf.

Se o servidor não conseguir alcançar `graph.facebook.com`:

> Não foi possível alcançar a Graph API da Meta ao ler o número de
> telefone: fetch failed. Verifique se este servidor tem acesso de saída
> à internet para graph.facebook.com e tente novamente.

## Credenciais válidas, mas nenhuma mensagem chega

1. Clique em **Testar conexão da API**. Se disser *"A conta do WhatsApp
   Business não está inscrita neste app"*, informe o token novamente e
   salve de novo — o salvamento inscreve o WABA.
2. Confira o banner de *Status do registro*. *Não registrado* significa que
   o `/register` nunca teve sucesso para este número; informe o PIN de duas
   etapas e salve.
3. Clique em **Verificar com a Meta** para um detalhamento por verificação
   (`phone_metadata_ok`, `waba_subscribed_to_app`,
   `locally_marked_registered`).
4. Confirme o próprio webhook: no App da Meta → WhatsApp → Configuration, a
   URL de callback deve ser `https://<seu host>/api/whatsapp/webhook`, o
   verify token deve ser igual ao salvo aqui e o campo `messages` deve
   estar inscrito. O `META_APP_SECRET` no ambiente do servidor deve ser o
   segredo *daquele* app, senão toda entrega é rejeitada com um 401 antes
   de o wacrm olhá-la.

## Onde fica o mapeamento

* `src/lib/whatsapp/meta-error-explain.ts` — código → explicação, campo e
  lado 400/502. Puro e testado por unidade; adicione novos códigos lá.
* `src/lib/whatsapp/waba-pairing.ts` — verificação do formato do id e a
  verificação número-sob-WABA.
* `src/app/api/whatsapp/config/route.ts` — o fluxo de conexão. Toda falha
  da Meta retorna `{ error, meta: { code, subcode, fbtrace_id, step, field,
  message } }`.
