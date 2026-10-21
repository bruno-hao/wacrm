# Changelog

Mudanças visíveis ao usuário no `wacrm`. Para quem hospeda por conta
própria: ao atualizar, confira este arquivo em busca de avisos de
**migration necessária** e aplique os arquivos SQL correspondentes de
`supabase/migrations/` no seu projeto Supabase antes de reiniciar o app.

As versões seguem o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Antes da 1.0, os incrementos de `MINOR` cobrem novos módulos; os de `PATCH`
cobrem correções de bugs e acabamento.

## [0.8.1] — 2026-07-10

Corrige conversas de entrada que se fragmentavam em várias threads para o
mesmo número.

> **Migration necessária:** aplique `supabase/migrations/036_conversation_contact_dedup.sql`
> (mescla as conversas duplicadas existentes na thread mais antiga — nenhuma
> mensagem é perdida — e então adiciona um índice `UNIQUE (account_id, contact_id)`
> para que um contato só possa ter uma conversa).

### Corrigido

- **Chats duplicados para um único contato.** Uma mensagem de entrada podia
  criar uma segunda conversa para um contato numa condição de corrida (a
  Meta reenvia uma entrega, ou um lote se distribui em execuções
  concorrentes). Uma vez que existiam duas, a busca com `.single()` dava
  erro em toda mensagem seguinte e o webhook criava mais uma conversa a
  cada vez, virando uma bola de neve de chats duplicados. A lógica de
  localizar-ou-criar agora resolve para a thread existente mais antiga e um
  índice único no banco torna a regra de uma conversa por contato
  definitiva. O mesmo reforço foi aplicado ao resolvedor de conversas da
  API pública. (Issue #363)

## [0.8.0] — 2026-07-08

Aperfeiçoa o bot de resposta automática por IA: agora ele é **visível e
controlável pelo inbox**, sua **transferência realmente transfere** e seu
**gasto de tokens é registrado**.

> **Migration necessária:** aplique `supabase/migrations/033_ai_reply_polish.sql`
> (adiciona `messages.ai_generated`, `ai_configs.handoff_agent_id`,
> `conversations.ai_handoff_summary` e a tabela `ai_usage_log`).

### Adicionado

- **Selo "AI" no inbox.** As respostas enviadas pelo bot recebem um pequeno
  selo ✨ AI, para que os atendentes distingam de relance uma resposta
  automática da própria ou de um Flow. (Nova flag `messages.ai_generated`;
  somente o bot de resposta automática a define.)
- **Assumir / Retomar a partir da thread.** Um banner nas conversas
  atendidas por IA permite ao atendente **Assumir** (pausa o bot naquela
  thread e a atribui a ele) ou **Retomar IA** (devolve a thread e remove a
  pausa). Apoiado em `POST /api/ai/autoreply/[id]`.
- **Transferência real.** Quando o bot desiste (não consegue ajudar ou
  atinge o limite de respostas), ele agora (1) encaminha a conversa para um
  **destino de transferência** configurável — um atendente específico ou a
  fila sem atribuição — e (2) deixa uma curta **nota interna** resumindo a
  troca para quem assumir. Atribuir dispara a notificação de atribuição
  existente. Escolha o destino em **Agentes de IA → Configuração →
  Transferir para**.
- **Registro de uso de tokens + dashboard.** Cada rascunho e resposta
  automática registra as contagens de tokens do provedor na nova tabela
  `ai_usage_log` (legível por admins). Uma nova aba **Agentes de IA → Uso**
  (somente admin) mostra em gráfico o gasto diário de tokens na sua chave
  própria, com detalhamento por modo e por modelo, apoiada em
  `GET /api/ai/usage`. Apenas contagens — nenhum conteúdo de mensagem é
  armazenado ou exibido.

### Alterado

- A resposta automática agora tem um **limite de taxa para a conta toda**
  (30/min) além do limite por conversa já existente, para que uma rajada de
  mensagens de entrada não leve a sua chave do provedor além do limite.
  Acima do limite, as mensagens de entrada simplesmente aguardam no inbox
  por um humano em vez de serem respondidas automaticamente.

## [0.7.0] — 2026-07-02

Promove o assistente de IA a uma seção de primeira classe, **Agentes de
IA**, na barra lateral — ele não fica mais escondido dentro das
Configurações.

### Adicionado

- **Agentes de IA (barra lateral).** Uma área `/agents` dedicada com duas
  abas:
  - **Playground** — um chat de teste para conversar com o seu agente e ver
    suas respostas fundamentadas e de vários turnos (e onde ele
    transferiria para um humano) *antes* de ele responder a um cliente de
    verdade. Executa exatamente o mesmo caminho do bot de resposta
    automática (recuperação da base de conhecimento + seu provedor) e
    funciona até antes de você ligar a chave geral, para que você possa
    testar e depois ativar. Apoiado em `POST /api/ai/playground`.
  - **Configuração** — o provedor/chave, o contexto do negócio, a base de
    conhecimento e os controles de resposta automática (movidos de
    Configurações → Assistente de IA).

### Alterado

- A configuração de IA saiu de **Configurações → Assistente de IA** para a
  nova seção **Agentes de IA**. Sem mudança de dados — mesma configuração
  da conta, novo endereço. Nenhuma migration necessária.

## [0.6.0] — 2026-07-02

Adiciona uma **base de conhecimento de IA** para que o assistente (0.5.0)
responda a partir do seu próprio conteúdo em vez de transferir. Cole FAQs,
políticas ou detalhes de produtos em **Configurações → Assistente de IA →
Base de conhecimento**; os trechos relevantes são recuperados em todo
rascunho e resposta automática.

### Adicionado

- **Base de conhecimento com recuperação híbrida.** A busca lexical
  full-text do Postgres funciona em toda conta, sem credenciais extras. A
  **busca semântica** opcional (pgvector, `text-embedding-3-small` da
  OpenAI) é ativada quando você adiciona uma **chave de embeddings** —
  semântica como principal, complementada pela lexical para completar o
  conjunto de resultados. Contas somente com Anthropic (a Anthropic não tem
  API de embeddings) mantêm o caminho lexical sem nenhuma configuração
  extra.
- **Gerenciador da base de conhecimento** em Configurações — adicione,
  edite e exclua documentos, e uma ação **Reindexar** para preencher os
  embeddings depois de adicionar uma chave. Tanto os rascunhos quanto o bot
  de resposta automática se baseiam nos trechos recuperados, e o prompt
  continua instruindo o modelo a transferir (resposta automática) ou a
  dizer que fará o acompanhamento (rascunho) quando a base não cobre a
  pergunta.
  **Migration necessária:** aplique `supabase/migrations/030_ai_knowledge.sql`
  (habilita o `pgvector`; adiciona `ai_knowledge_documents` +
  `ai_knowledge_chunks` e uma coluna `embeddings_api_key` em `ai_configs`).

## [0.5.0] — 2026-07-02

Adiciona o **assistente de respostas com IA** — traga sua própria chave.
Cada conta cola sua própria chave da OpenAI ou da Anthropic em
**Configurações → Assistente de IA**; o wacrm chama o provedor diretamente
com essa chave, então não há cobrança de IA por usuário e os dados das suas
conversas nunca saem da sua própria infraestrutura para um serviço operado
pelo wacrm. A chave é armazenada criptografada em repouso com AES-256-GCM
(igual aos tokens do WhatsApp) e nunca é devolvida ao cliente depois de
salva.

### Adicionado

- **Respostas rascunhadas por IA no inbox.** Um botão ✨ no campo de
  composição (agent+) lê a conversa recente e coloca uma resposta sugerida
  na caixa para o atendente editar e enviar. Somente leitura no servidor —
  `POST /api/ai/draft` nunca envia nem armazena nada. Respeita o contexto
  do negócio / persona definido no prompt das configurações.
- **Bot de resposta automática por IA.** Quando ativado, as mensagens de
  entrada que nenhum Flow determinístico consumiu e que não têm atendente
  atribuído recebem uma resposta automática de um LLM. Limitada por um teto
  por conversa (`auto_reply_max_per_conversation`, padrão 3) e por uma
  transferência limpa para um humano: quando o modelo não consegue ajudar
  com confiança — ou o cliente pede uma pessoa — ele fica em silêncio e
  deixa a mensagem para um humano, e não responde automaticamente naquela
  thread novamente até ser reativado. Os Flows sempre têm prioridade sobre
  o bot.
- **Configurações → Assistente de IA** (admin+ para editar): escolha o
  provedor + modelo, cole sua chave, adicione contexto/tom do negócio,
  ligue o assistente e a resposta automática, defina o teto por conversa e
  **Teste a chave** no provedor antes de salvar.
- Provedores: OpenAI (Chat Completions) e Anthropic (Messages) atrás de
  uma única interface; o modelo é um campo de texto livre com padrões
  sensatos, para que você possa apontar para qualquer modelo atual a que
  sua chave tenha acesso.
  **Migration necessária:** aplique `supabase/migrations/029_ai_reply.sql`
  (adiciona `ai_configs` + colunas de resposta automática por conversa em
  `conversations`).

## [0.4.0] — 2026-07-01

Conclui a API pública (#245): **webhooks de eventos de saída**, para que as
automações possam *reagir* à atividade em vez de fazer polling.

### Adicionado

- **Webhooks de eventos de saída (`/api/v1/webhooks`).** Registre um
  endpoint HTTPS (escopo `webhooks:manage`) para receber um POST quando um
  evento acontecer na sua conta — `message.received`,
  `message.status_updated` ou `conversation.created`. Gerencie os endpoints
  com `GET/POST /api/v1/webhooks` e `GET/PATCH/DELETE /api/v1/webhooks/{id}`.
  Cada entrega é assinada com um `X-Wacrm-Signature` (HMAC-SHA256 sobre
  `timestamp.body`) para que os receptores possam verificar a autenticidade
  e rejeitar replays; o segredo de assinatura é devolvido uma vez na
  criação e armazenado criptografado. A entrega é de melhor esforço — um
  endpoint que falha repetidamente é desativado automaticamente após um
  limite de falhas consecutivas. Veja `docs/public-api.md`.
  **Migration necessária:** aplique `supabase/migrations/028_webhook_endpoints.sql`.
  ([#245](https://github.com/ArnasDon/wacrm/issues/245))

## [0.3.0] — 2026-07-01

Chegam as contas multiusuário. Toda instalação do wacrm é multi-tenant no
lado do banco: o cadastro de um único usuário cria uma "conta" nova, e cada
linha é isolada por essa conta, e não diretamente pelo usuário. Esta versão
também abre a todos os usuários a superfície visível **Membros** — convidar
colegas por link, gerenciar seus papéis, transferir a propriedade. A trava
beta `'account_sharing'`, que a escondia durante o desenvolvimento, foi
removida (espelha o soft-GA dos Flows na 0.2.0). As instâncias
self-hosted existentes continuam funcionando: todo usuário existente é
preenchido como único owner da própria conta e vê dados idênticos, e um
owner solo que nunca convida ninguém vê o mesmo app de usuário único de
sempre.

### Adicionado

- **API REST pública (`/api/v1`) — base.** Um sistema de **chaves de API**
  com escopo e revogáveis para você controlar o wacrm a partir dos seus
  próprios scripts e automações. Crie chaves em **Configurações → Chaves de
  API** (admin+), conceda apenas os escopos de que cada integração precisa
  e autentique com `Authorization: Bearer <chave>`. As chaves têm escopo de
  conta e são armazenadas com hash (o texto puro é mostrado uma vez). Esta
  versão entrega a camada de autenticação, os escopos, o limite de taxa por
  chave, a interface de gerenciamento e uma sonda `GET /api/v1/me` para
  verificar uma chave. Veja `docs/public-api.md`. **Migration necessária:**
  aplique `supabase/migrations/026_api_keys.sql`.
  ([#245](https://github.com/ArnasDon/wacrm/issues/245))
- **API REST pública — endpoints de dados.** Construídos sobre a
  autenticação por chave acima, para que automações externas possam ler e
  controlar o CRM:
  - `POST /api/v1/messages` — envia uma mensagem de texto / template /
    mídia para um número de telefone; localiza ou cria o contato + a
    conversa (`messages:send`).
  - `GET/POST /api/v1/contacts`, `GET/PATCH /api/v1/contacts/{id}` —
    lista (busca + filtro por tag), cria (localizar ou criar por
    telefone), lê e atualiza contatos, incluindo tags (`contacts:read` /
    `contacts:write`).
  - `GET /api/v1/conversations`, `GET /api/v1/conversations/{id}` e
    `GET /api/v1/conversations/{id}/messages` — navega pelas conversas e
    seu histórico de mensagens com status de entrega (`conversations:read` /
    `messages:read`).
  - `POST /api/v1/broadcasts` + `GET /api/v1/broadcasts/{id}` — inicia um
    disparo de template para uma lista de destinatários e acompanha seu
    progresso (`broadcasts:send`).
  Todos os endpoints de listagem compartilham um único contrato de
  paginação por cursor (`{ data, meta: { next_cursor } }`). Nenhuma
  migration necessária — os escopos já existiam e as tabelas não mudaram.
  Os webhooks de eventos de saída (reagir a mensagens de entrada) são o
  item restante do roadmap. Veja `docs/public-api.md`.
  ([#245](https://github.com/ArnasDon/wacrm/issues/245))

### Alterado

- **A tenancy passa de por usuário para por conta.** O RLS de toda tabela
  de domínio (contatos, conversas, mensagens, disparos, automações, fluxos,
  funis, templates, tags, …) agora verifica a participação na conta por
  meio de um novo helper SECURITY DEFINER `is_account_member(account_id,
  min_role)` em vez de `auth.uid() = user_id`. As colunas `user_id`
  permanecem em cada linha para atribuição / auditoria, mas deixam de
  impor o isolamento.
- **A configuração do WhatsApp é uma por conta, não uma por usuário.** A
  restrição `whatsapp_config.UNIQUE(user_id)` é substituída por
  `UNIQUE(account_id)`.
- **A chave de idempotência de `flow_runs` passa para `(account_id,
  contact_id)`**, para que duas contas que compartilham o telefone de um
  contato possam executar seus próprios fluxos de forma independente.
- **O gatilho de cadastro (`handle_new_user`) agora também cria uma conta
  pessoal** e vincula o novo perfil a ela como `owner`.

### Alterado

- **O armazenamento de mídia dos fluxos agora tem escopo de conta.** A
  migration 016 colocava os arquivos enviados sob `auth.uid()/...`, o que
  deixava a mídia dos fluxos órfã quando um colega saía de uma conta
  compartilhada. Os novos uploads vão para `account-<account_id>/...` e
  qualquer membro da conta com o papel adequado pode editá-los. Os
  caminhos legados continuam graváveis pelo autor original do upload, por
  compatibilidade.
- **A busca de contato no webhook agora pré-filtra no SQL.** Antes, trazia
  todos os contatos de uma conta só para filtrar em JS até uma linha por
  telefone — aceitável quando conta = um usuário, doloroso quando conta =
  equipe. Agora se pré-filtra pelo final do telefone no lado do banco e se
  reaplica `phonesMatch` sobre o conjunto de candidatos (tipicamente 0–2
  linhas).

### Migration necessária

- `supabase/migrations/020_account_sharing_followups.sql` — índices
  parciais compostos em `automations(account_id, trigger_type) WHERE
  is_active` e `flows(account_id) WHERE status='active'` para o caminho
  quente de despacho dos motores; RLS do armazenamento `flow-media`
  atualizado para permitir escrita por membros da conta sob a nova
  convenção de caminho. Idempotente.

- **Bloqueio de UI por papel em todo o app.** O botão de enviar + a área de
  texto do compositor do inbox, os botões "Novo disparo / automação /
  fluxo", os botões "Adicionar funil / negócio" e os botões "Adicionar /
  Importar contato" agora ficam desativados-com-tooltip para viewers (e
  para agents em ações de nível de configurações). Escolha de projeto:
  mostrar-mas-desativar em vez de esconder, para que a UI nunca pareça
  silenciosamente quebrada a um colega olhando uma funcionalidade para a
  qual ainda não tem permissão.
- **A barra lateral exibe a conta ativa** acima das informações do usuário
  sempre que o nome da conta difere do seu — isto é, depois que você
  renomeou a conta ou entrou em uma compartilhada. Uma conta solo padrão
  leva o seu nome, então a faixa fica oculta para não duplicar o seu nome
  no rodapé.
- **Membros está aberto a todos os usuários.** A flag beta
  `account_sharing`, que escondia a aba Configurações → Membros e a faixa
  de conta da barra lateral durante o desenvolvimento, acabou; a superfície
  multiusuário agora faz parte do app padrão. (Mesmo movimento de soft-GA
  dos Flows na 0.2.0.)

### Corrigido

- **As mensagens de WhatsApp de entrada agora chegam ao inbox
  compartilhado.** O webhook + os motores de automações + fluxos
  roteavam eventos de entrada por `user_id`, o que após a migration 017
  só correspondia às automações / fluxos do dono da configuração do
  WhatsApp — as regras dos colegas nunca disparavam. O PR 8 da série
  multiusuário troca toda busca para `account_id`, de modo que qualquer
  membro da conta vê a mensagem de entrada e a automação ou fluxo de
  qualquer colega pode reagir a ela. Também corrige violações incipientes
  de NOT NULL em `automation_logs`, `automation_pending_executions`,
  `flow_runs` e `deals` — essas tabelas ganharam `account_id NOT NULL` na
  017, mas os motores ainda não tinham sido atualizados para preenchê-lo.

### Adicionado

- **Números de telefone duplicados agora são impedidos entre contatos.**
  Um número de telefone não pode mais virar mais de um contato na mesma
  conta. Adicionar um contato cujo número já existe é bloqueado com um link
  para o registro existente (e um aviso mais brando para quase-correspondências
  que compartilham os últimos 8 dígitos); a importação de CSV deduplica
  dentro do arquivo e contra os contatos existentes, informando "X
  importados, Y duplicados ignorados". A regra é imposta por um índice
  único no banco sobre o número normalizado, então o webhook do WhatsApp, o
  formulário, a importação e qualquer caminho futuro concordam. As
  duplicatas existentes são mescladas no contato mais antigo na atualização
  (suas conversas, negócios, notas e tags são reapontados; nada se perde).
  Fecha #212.
- **Moeda padrão de negócios configurável.** Cada conta agora pode escolher
  sua moeda padrão em **Configurações → Negócios** (admin+); o app antes
  tinha USD fixo em todo lugar. Os novos negócios usam essa moeda por
  padrão, e os totais das etapas do funil, o cartão "Valor de negócios
  abertos" do dashboard, o donut de valor do funil e os negócios criados
  por automação passam todos a usá-la. Os negócios existentes mantêm a
  moeda com que foram salvos — os totais são exibidos na moeda padrão da
  conta, sem conversão cambial (uma moeda por conta). Guia completo:
  [Moeda padrão](https://wacrm.tech/docs/settings#deals).
- **Aba Membros em Configurações.** A superfície voltada ao usuário para as
  APIs multiusuário abaixo, disponível a todos (sem flag beta). Em
  Configurações → **Membros**, um admin ou owner pode: ver quem está na
  conta com seu papel e data de entrada, convidar colegas gerando um link
  de compartilhamento de uso único (escolha o papel + expiração opcional),
  revogar convites pendentes, alterar o papel de um membro, remover um
  membro e — como owner — transferir a propriedade. Os destinatários
  aceitam por uma página pública `/join/[token]`. Guia completo:
  [Documentação de Membros](https://wacrm.tech/docs/members).
- **API de gerenciamento de conta e membros** — endpoints no servidor que
  sustentam a aba Membros. Todas as rotas são controladas por papel e
  retornam dados com escopo do RLS do Supabase.
  - `GET /api/account` — conta e papel de quem chama. Qualquer membro.
  - `PATCH /api/account` — renomeia a conta. Admin+.
  - `GET /api/account/members` — lista os membros. O e-mail é visível
    apenas para admin+; agents/viewers veem nome + avatar + papel + data
    de entrada.
  - `PATCH /api/account/members/[userId]` — altera o papel de um membro.
    Admin+. A promoção/rebaixamento do owner passa pelo endpoint de
    transferência.
  - `DELETE /api/account/members/[userId]` — remove um membro. Admin+. O
    usuário removido mantém o login e é movido para uma conta pessoal
    recém-criada (espelho do fluxo de cadastro).
  - `POST /api/account/transfer-ownership` — somente owner. Troca atômica
    com o membro indicado.
- **API de convites + fluxo de resgate** — o caminho de convite somente por
  link, sem e-mail, que alimenta o botão "Convidar membro" da aba Membros e
  a página de aceite `/join/[token]`.
  - `GET /api/account/invitations` — lista os pendentes (admin+).
  - `POST /api/account/invitations` — cria um convite, retorna o token em
    texto puro + a URL de compartilhamento **exatamente uma vez**
    (armazenamos na linha apenas o hash SHA-256). Corpo
    `{ role, expiresInDays?, label? }`. Admin+.
  - `DELETE /api/account/invitations/[id]` — revoga (admin+).
  - `GET /api/invitations/[token]/peek` — público, com limite de taxa por
    IP. Retorna `{ ok, account_name, role, expires_at }` ou `{ ok: false,
    reason }` para que a página de entrada possa exibir "Você está sendo
    convidado para <Conta> como <Papel>".
  - `POST /api/invitations/[token]/redeem` — autenticado. Move
    atomicamente o perfil de quem chama para a conta de quem convidou e
    limpa a conta pessoal órfã. Recusa com 409 se a conta atual de quem
    chama já contém dados de domínio (sem perda silenciosa de dados).

### Migration necessária

Aplique no seu projeto Supabase antes de publicar esta versão:

- `supabase/migrations/017_account_sharing.sql` — introduz as tabelas
  `accounts` e `account_invitations` e um tipo `account_role_enum`;
  adiciona `account_id` a toda tabela com escopo de usuário e o
  preenche; reescreve todas as políticas de RLS; substitui o gatilho de
  novo usuário. Idempotente. **Sem perda de dados** — todo usuário
  existente é mapeado para uma conta recém-criada com o papel `owner` e
  cada linha existente dele é vinculada a essa conta.
- `supabase/migrations/018_account_member_rpcs.sql` — adiciona três RPCs
  `SECURITY DEFINER` (`set_member_role`, `remove_account_member`,
  `transfer_account_ownership`) que sustentam a API de gerenciamento de
  membros. Elas verificam por conta própria o papel de quem chama e
  levantam SQLSTATE `42501` / `22023` em entrada proibida/inválida, para
  que a camada de API mapeie de forma limpa para 403 / 400. Idempotente.
- `supabase/migrations/019_invitation_rpcs.sql` — adiciona duas RPCs
  `SECURITY DEFINER`: `peek_invitation` (leitura anônima pelo hash do
  token, retorna um envelope JSON de formato fixo) e `redeem_invitation`
  (movimentação atômica autenticada + limpeza de órfãos, com verificação de
  segurança de dados de domínio). Ambas contornam o RLS que de outra forma
  bloquearia suas leituras/escritas. Idempotente.
- `supabase/migrations/021_account_default_currency.sql` — adiciona
  `accounts.default_currency` (`TEXT NOT NULL DEFAULT 'USD'`, com um
  `CHECK` de código de 3 letras) que sustenta a moeda padrão configurável.
  Idempotente; as contas existentes são preenchidas com `USD`. **Aplique
  antes de publicar** — o app agora lê essa coluna ao carregar a conta,
  então um banco sem a migration quebra o carregamento da conta.
- `supabase/migrations/022_contact_phone_dedup.sql` — adiciona a coluna
  gerada `contacts.phone_normalized`, **mescla os contatos duplicados
  existentes no mais antigo** (reapontando conversas, negócios, notas,
  tags, valores personalizados e destinatários de disparos — sem perda de
  dados) e então adiciona um índice `UNIQUE (account_id, phone_normalized)`.
  Idempotente. **Aplique antes de publicar** — a importação de CSV lê
  `phone_normalized`, e o índice é o que impõe a deduplicação em todo
  caminho de escrita. A mesclagem única roda dentro da migration.

## [0.2.2] — 2026-05-29

Os nós de fluxo agora podem enviar mídia. Fecha a lacuna mais pedida no
feedback dos usuários após o lançamento dos Flows na v0.2.0 — os fluxos
eram só de texto e não conseguiam entregar uma fatura, recibo, foto de
produto ou um vídeo curto de demonstração no meio de uma conversa.

### Adicionado

- **Nó de fluxo `send_media`.** Envie uma imagem (PNG / JPEG / WebP),
  vídeo (MP4 / 3GP) ou documento (PDF, Word, Excel, PowerPoint, TXT) ao
  cliente em qualquer ponto de um fluxo. Escolha um arquivo no construtor,
  ele é enviado ao novo bucket `flow-media` do Supabase Storage, e a Meta
  busca a URL pública no momento do envio. Legenda opcional (limite de 1024
  caracteres, aceita interpolação `{{vars.X}}`); os documentos também
  aceitam um nome de arquivo opcional exibido no chat do destinatário.
  Avança automaticamente após o envio — mesma semântica de suspensão do
  `send_message`.
  ([#156](https://github.com/ArnasDon/wacrm/pull/156))

### Migration necessária

Aplique no seu projeto Supabase antes de publicar esta versão:

- `supabase/migrations/016_flow_media.sql` — faz duas coisas:
  1. Adiciona `'send_media'` à restrição CHECK de `flow_nodes.node_type`.
     Sem isso, o nó `send_media` falha ao salvar com uma violação de
     restrição.
  2. Cria o bucket público `flow-media` do Supabase Storage (limite de
     arquivo de 16 MB, lista de permissão de MIME de imagem / vídeo /
     documento) mais políticas de RLS por usuário (prefixo do caminho =
     `auth.uid()`). Sem isso, o seletor de arquivos do construtor falha no
     upload. Mesmo formato do bucket `avatars` da migration 008 — o bucket
     é **público** para que a Meta possa buscar a URL sem credenciais.

A migration é idempotente e segura para reexecutar.

## [0.2.1] — 2026-05-26

Versão de correção de bug. Tampa uma perda silenciosa de mensagens de
entrada que ocorria quando dois usuários da mesma instância salvavam o
mesmo `phone_number_id` do WhatsApp.

### Corrigido

- **As mensagens de WhatsApp de entrada não somem mais silenciosamente**
  quando dois usuários reivindicaram o mesmo `phone_number_id`. Antes, o
  webhook usava `.single()` para buscar a configuração dona, o que dá erro
  `PGRST116` tanto para 0 linhas *quanto* para ≥2 linhas — o salvamento do
  segundo usuário colocava o banco no estado de ≥2 linhas e toda mensagem
  de entrada era descartada enquanto o log informava, de forma enganosa,
  *"No config found for phone_number_id"*. Correção em três camadas:
  `POST /api/whatsapp/config` agora retorna **409** quando outro usuário já
  reivindicou o número, a busca do webhook distingue 0 linhas de ≥2 linhas
  e registra em log os `user_id`s em conflito, e uma nova restrição no banco
  (`UNIQUE(phone_number_id)`) impede o estado inválido na camada de
  armazenamento. Reportado na
  [#136](https://github.com/ArnasDon/wacrm/issues/136), corrigido no
  [#143](https://github.com/ArnasDon/wacrm/pull/143).

### Migration necessária

Aplique no seu projeto Supabase antes de publicar esta versão:

- `supabase/migrations/013_whatsapp_config_phone_number_id_unique.sql`
  — adiciona `UNIQUE(phone_number_id)` a `whatsapp_config`. **Falha de
  forma explícita, com uma dica de resolução pronta para copiar**, se já
  existirem linhas duplicadas; deduplicar automaticamente destruiria tokens
  criptografados, então o operador escolhe qual linha fica com o número.
  Para conferir antes:

  ```sql
  SELECT phone_number_id, array_agg(user_id) AS owners, count(*) AS n
  FROM whatsapp_config
  GROUP BY phone_number_id
  HAVING count(*) > 1;
  ```

  Se isso retornar linhas, faça `DELETE` da(s) linha(s) duplicada(s) que
  quiser descartar e reexecute a migration.

### Nota sobre configurações multiusuário

O wacrm é intencionalmente **single-tenant por número de WhatsApp**. O RLS
em `conversations`/`messages` é `auth.uid() = user_id`, então um segundo
usuário fisicamente não consegue ler mensagens roteadas para outro dono —
dois usuários compartilhando um número nunca foi suportado. Se você precisa
de vários humanos atendendo o mesmo inbox, rode-os sob uma conta
compartilhada.

## [0.2.0] — 2026-05-22

A versão dos **Flows**. Adiciona um motor de conversa de WhatsApp sem
código, ramificado e guiado por botões, que roda ao lado das Automações.
Também traz um seletor de cores com 5 temas em Configurações e abre os
Flows a todos os usuários.

### Adicionado

#### Flows — conversas de chatbot ramificadas

- **Módulo + schema.** Novas tabelas `flows`, `flow_nodes`, `flow_runs`,
  `flow_run_events` com índices únicos parciais que impõem uma execução
  ativa por contato. O CHECK de `messages.content_type` foi ampliado para
  aceitar `'interactive'`; foi adicionada a coluna `interactive_reply_id`
  para que o inbox possa renderizar toques em botões/listas.
  ([#112](https://github.com/ArnasDon/wacrm/pull/112))
- **Motor executor.** `dispatchInboundToFlows` analisa cada webhook de
  entrada, decide se a mensagem é uma resposta numa execução ativa ou um
  novo gatilho, avança a máquina de estados e informa de volta ao webhook
  para que as mensagens consumidas não disparem também as automações.
  Idempotente no `message_id` da Meta.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))
- **Interface do construtor sem código** em `/flows`. Editor em lista linear
  com formulários de configuração por nó, validador ao vivo, status
  rascunho/ativo/arquivado e uma API REST de 5 rotas (`GET/POST
  /api/flows`, `GET/PUT/DELETE /api/flows/[id]`, `POST
  /api/flows/[id]/activate`, `GET /api/flows/[id]/runs`, `GET
  /api/flows/templates`).
  ([#115](https://github.com/ArnasDon/wacrm/pull/115))
- **Templates + tipos de nó da v1.5.** Três templates iniciais (Menu de
  boas-vindas, Bot de FAQ, Captura de leads) clonáveis a partir do diálogo
  Novo fluxo. Três novos tipos de nó: `collect_input` (captura o texto do
  cliente em uma variável), `condition` (ramifica por variável / tag /
  campo do contato), `set_tag` (adiciona ou remove uma tag). Interpolação
  `{{vars.X}}` nos prompts de send_message + collect_input. Visualizador de
  histórico de execuções por fluxo em `/flows/[id]/runs`.
  ([#117](https://github.com/ArnasDon/wacrm/pull/117))
- **Cron de limpeza de execuções paradas** em `GET /api/flows/cron` — marca
  como `timed_out` as execuções que passaram do timeout configurado (padrão
  24h), para que conversas abandonadas liberem o contato para novos
  gatilhos. Reutiliza `AUTOMATION_CRON_SECRET`.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))

#### Temas de cor

- **5 temas de cor** (Violet padrão, Emerald, Cobalt, Amber, Rose)
  selecionáveis em uma nova aba **Aparência** em Configurações. Variáveis
  CSS com escopo em `html[data-theme="..."]`, aplicadas em runtime via
  `dataset.theme`, persistidas em `localStorage`. Um script de boot inline
  em `layout.tsx` reaplica a escolha antes da primeira pintura, sem
  flash do tema padrão.
  ([#132](https://github.com/ArnasDon/wacrm/pull/132))
- **Varredura de tokenização de tema** — toda classe Tailwind `violet-*`
  antes fixa no código foi substituída por tokens `primary` em ~49
  arquivos. Escolher um tema que não seja violet agora aplica o tema ao app
  inteiro, e não só ao chrome.
  ([#133](https://github.com/ArnasDon/wacrm/pull/133))

### Alterado

#### Flows — soft-GA

- **Os Flows agora estão disponíveis para todo usuário autenticado.** A
  trava beta por conta acabou; a entrada da barra lateral + o cabeçalho da
  página levam um pequeno chip "Beta" como único sinal restante.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))
- **UX do editor**:
  - Os identificadores internos `node_key` + `reply_id` por botão/linha
    ficam escondidos atrás de uma divulgação "Mostrar avançado" por nó.
    ([#118](https://github.com/ArnasDon/wacrm/pull/118))
  - Nós `send_list` podem ter várias seções.
    ([#119](https://github.com/ArnasDon/wacrm/pull/119))
  - Os cartões de nó recolhidos mostram uma prévia de 1 linha do conteúdo
    por tipo de nó (trecho de texto, títulos de botões, resumo da condição,
    etc.).
    ([#120](https://github.com/ArnasDon/wacrm/pull/120))
  - Os problemas de validação são clicáveis: levam ao nó problemático e o
    destacam.
    ([#121](https://github.com/ArnasDon/wacrm/pull/121))
  - Indicador "● Editado" de alterações não salvas + proteção de reload
    com `beforeunload`.
    ([#122](https://github.com/ArnasDon/wacrm/pull/122))
  - O diálogo Novo fluxo agora realmente se alarga para caber os 3 cartões
    de template (estava limitado a 384px por um `sm:max-w-sm` embutido do
    shadcn).
    ([#129](https://github.com/ArnasDon/wacrm/pull/129),
    [#131](https://github.com/ArnasDon/wacrm/pull/131))
  - O painel de validação fixado no rodapé da viewport, para que a
    prontidão de ativação acompanhe o usuário enquanto ele rola pelos nós.
    ([#130](https://github.com/ArnasDon/wacrm/pull/130))

#### Confiabilidade do motor

- **Incremento atômico de `execution_count`** via RPC SECURITY DEFINER —
  evita contagens perdidas quando dois webhooks iniciam execuções ao mesmo
  tempo. Espelha o padrão do motor de automações.
  ([#124](https://github.com/ArnasDon/wacrm/pull/124))
- **Pré-carregar todos os flow_nodes uma vez por despacho** — um SELECT por
  mensagem de entrada em vez de um por iteração do loop de avanço. Uma
  cadeia de 5 nós com avanço automático agora custa 1 ida ao banco, não 5.
  ([#125](https://github.com/ArnasDon/wacrm/pull/125))
- **Releitura desperdiçada eliminada** após o reset do reprompt;
  `loadActiveRun` passou a usar um `.limit(1)` defensivo para que uma falha
  de migration que produza duplicatas não derrube o despacho.
  ([#126](https://github.com/ArnasDon/wacrm/pull/126))

### Segurança

- **PII removida do payload do evento `reply_received`** — o texto do
  cliente não é mais persistido em `flow_run_events.payload`; apenas o
  comprimento. Um prompt de `collect_input` perguntando "qual o número do
  seu cartão?" deixava o PAN guardado na tabela de eventos.
  ([#123](https://github.com/ArnasDon/wacrm/pull/123))
- **Comparação em tempo constante do segredo do cron** em `/api/flows/cron`
  (`crypto.timingSafeEqual`) para fechar um canal lateral teórico de
  temporização na verificação do header `x-cron-secret`.
  ([#127](https://github.com/ArnasDon/wacrm/pull/127))

### Corrigido

- **`/flows` não redireciona mais indevidamente para `/dashboard`** ao
  navegar para ele. Causa raiz: o `useAuth` passava `loading: false` antes
  de a busca do perfil terminar. O `use-auth` agora expõe um booleano
  `profileLoading` separado.
  ([#128](https://github.com/ArnasDon/wacrm/pull/128))

### Migration necessária

Aplique, em ordem, no seu projeto Supabase:

1. `supabase/migrations/010_flows.sql` — tabelas centrais dos Flows,
   índices, políticas de RLS e a ampliação do schema de `messages`.
2. `supabase/migrations/011_profile_beta_features.sql` — adiciona a coluna
   `profiles.beta_features`. Permanece para futuros betas; os Flows não a
   leem mais.
3. `supabase/migrations/012_flows_increment_counter.sql` — RPC de contador
   atômico. Sem ela o motor ainda roda, mas `flows.execution_count` fica
   sujeito a corrida.

Cada migration é idempotente — segura para reexecutar se você não tem
certeza de ter aplicado uma anterior.

### Removido

- **`src/lib/flows/feature-flag.ts`** + seus testes. Os Flows estão abertos
  a todos os usuários; a própria coluna `profiles.beta_features` permanece
  para futuras travas beta.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))

---

## [0.1.1] — 2026-05-19

### Adicionado

- Ações de chat no inbox: reações com emoji, responder com citação e copiar
  texto em mensagens individuais. Hover no desktop, toque longo no touch.
  As reações e respostas de saída são encaminhadas ao WhatsApp pela Cloud
  API; as reações e respostas por deslize de entrada vindas dos clientes
  chegam pelo webhook e aparecem em tempo real.

### Migration necessária

- Aplique `supabase/migrations/009_message_actions.sql` no seu projeto
  Supabase. Ela adiciona `messages.reply_to_message_id` e a nova tabela
  `message_reactions` (com RLS e realtime). A migration é idempotente —
  segura para reexecutar.

### Alterado

- O webhook não armazena mais as reações de entrada dos clientes como
  mensagens de texto falsas. Elas são gravadas em `message_reactions`, de
  modo que consultas personalizadas que contavam reações como mensagens
  precisarão ser atualizadas.

---

## [0.1.0]

Release inicial do template. CRM central: inbox, contatos, funis, disparos
em massa, automações (com um cron que drena os passos de Espera),
integração com a WhatsApp Cloud API, autenticação Supabase + RLS.
