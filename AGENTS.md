<!-- BEGIN:nextjs-agent-rules -->
# Este NÃO é o Next.js que você conhece

Esta versão tem mudanças incompatíveis — APIs, convenções e estrutura de arquivos podem ser todas diferentes do que consta no seu treinamento. Leia o guia relevante em `node_modules/next/dist/docs/` antes de escrever qualquer código. Preste atenção aos avisos de depreciação.
<!-- END:nextjs-agent-rules -->

## Fluxo obrigatório de alteração, commit e publicação

Após qualquer alteração solicitada pelo usuário, trate a solicitação como autorização para executar o fluxo completo de produção, nesta ordem. Não é necessário que ele use a palavra “commit” ou “deploy” separadamente:

1. validar a alteração e criar o commit local;
2. enviar o commit ao repositório Git remoto;
3. executar e acompanhar até o fim o workflow `publish-image.yml`, que publica a imagem no GHCR;
4. somente após o workflow concluir com sucesso, conectar à VPS `crm.oticamvision.com.br` por SSH na porta `22022`, atualizar a imagem e recriar o contêiner com `docker compose pull && docker compose up -d` em `/root/wacrm`;
5. confirmar que o contêiner está saudável e que a imagem executada corresponde à imagem publicada;
6. atualizar `CLAUDE.md`, `AGENTS.md` e o guia operacional da VPS (`/root/.claude/CLAUDE.md` e `/root/wacrm-handoff/LEIA-PRIMEIRO.md`) quando a alteração modificar comportamento, infraestrutura, versões, migrations ou procedimento operacional, e versionar essas atualizações no próximo commit.

Se qualquer etapa falhar, não avance para as seguintes. Informe o erro e o ponto exato em que o fluxo parou. Não é necessário pedir nova confirmação entre essas etapas.

## Estado atual relevante

- A branch de produção inclui agenda semanal de respostas automáticas de IA, fuso operacional `America/Sao_Paulo`, prompt seguro da Maria, transcrição automática/manual de áudio e leitura privada de receitas com escopo por conta.
- A migration mais recente é `067_ai_chat_assistant.sql`, que adiciona o prompt/modelo de respostas redigidas e a pausa automática após mensagem manual. Ela precisa estar aplicada no Supabase real antes de publicar uma imagem que use essas colunas.
- A migration `064_correios_shipments.sql` cria o monitoramento de encomendas; a rota protegida `/api/cron/correios` deve ser chamada a cada 4 horas e exige `CORREIOS_API_TOKEN` no ambiente do servidor.
- A migration `065_correios_credentials.sql` armazena criptografados o usuário/senha do Meu Correios e o token renovável por conta; a configuração fica em Configurações → Espaço de trabalho → Logística.
- A migration `066_google_reviews.sql` cria a configuração OAuth do Google Business Profile e os campos do agente de respostas de avaliações.
- A migration `067_ai_chat_assistant.sql` cria o Assistente de resposta do chat e a opção de pausar a IA quando um atendente envia mensagem.
- O controle de IA por conversa permanece visível no cabeçalho quando a IA está configurada; fica desabilitado enquanto `auto_reply_enabled` global estiver desligado, evitando confundir ausência do controle com ausência de configuração.
- A integração dos Correios aceita tanto usuário/senha do Meu Correios quanto uma chave CWS `cws-...` colada diretamente no painel Configurações → Espaço de trabalho → Logística; chaves CWS são armazenadas criptografadas como token Bearer sem renovação Basic.
- Em **Agentes de IA**, `IA Sandbox Cliente` testa conversas da Maria; `IA Sandbox Receitas` envia uma imagem apenas em memória para o modelo visual configurado. O sandbox de receitas não grava a imagem em Storage, mensagens ou tabelas e descarta os bytes após a leitura.
- O inbox deve ignorar conversas sem mensagem persistida (`last_message_at` nulo); registros órfãos não podem aparecer como chats acionáveis.
- Mídias recebidas do Instagram devem ser espelhadas no `chat-media`; o downloader tenta a CDN sem autenticação e repete com o token da conta quando a CDN responder 401/403. Nomes de contato usam `cleanContactName`, que remove emoji decorativo sem alterar palavras.
- Mensagens de texto com URL podem exibir prévia em `components/inbox/link-preview.tsx`, alimentada por `/api/link-preview` com validação SSRF e limite de HTML; não confie em URLs remotas sem passar pela rota.
- O `.gitignore` protege `.env*`, `docs/orcamento/simulacao/` e `WACRM-MVISION.md`, que pode conter continuidade e segredos de produção.
Mesmo alterações exclusivamente documentais devem ser commitadas e publicadas quando alterarem as instruções de operação. A documentação local e a documentação da VPS devem permanecer sincronizadas com o commit e a imagem efetivamente implantados.
