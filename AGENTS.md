<!-- BEGIN:nextjs-agent-rules -->
# Este NÃO é o Next.js que você conhece

Esta versão tem mudanças incompatíveis — APIs, convenções e estrutura de arquivos podem ser todas diferentes do que consta no seu treinamento. Leia o guia relevante em `node_modules/next/dist/docs/` antes de escrever qualquer código. Preste atenção aos avisos de depreciação.
<!-- END:nextjs-agent-rules -->

## Fluxo padrão de commit e publicação

Após qualquer alteração solicitada pelo usuário, trate a solicitação como autorização para executar o fluxo completo de produção, nesta ordem:

1. validar e criar o commit local;
2. enviar o commit ao repositório Git remoto;
3. executar e acompanhar até o fim o workflow `publish-image.yml`, que publica a imagem no GHCR;
4. somente após o workflow concluir com sucesso, conectar à VPS `crm.oticamvision.com.br` por SSH na porta `22022`, atualizar a imagem e recriar o contêiner com `docker compose pull && docker compose up -d` em `/root/wacrm`;
5. confirmar que o contêiner está saudável e que a imagem executada corresponde à imagem publicada.

Se qualquer etapa falhar, não avance para as seguintes. Informe o erro e o ponto exato em que o fluxo parou. Não é necessário pedir nova confirmação entre essas etapas.

## Estado atual relevante

- A branch de produção inclui agenda semanal de respostas automáticas de IA, fuso operacional `America/Sao_Paulo`, prompt seguro da Maria, transcrição automática/manual de áudio e leitura privada de receitas com escopo por conta.
- As migrations mais recentes são `062_ai_autoreply_schedule.sql` e `063_ai_prescription_reader.sql`. Elas precisam estar aplicadas no Supabase real antes de publicar uma imagem que use essas funcionalidades.
- A migration `064_correios_shipments.sql` cria o monitoramento de encomendas; a rota protegida `/api/cron/correios` deve ser chamada a cada 4 horas e exige `CORREIOS_API_TOKEN` no ambiente do servidor.
- A migration `065_correios_credentials.sql` armazena criptografados o usuário/senha do Meu Correios e o token renovável por conta; a configuração fica em Configurações → Espaço de trabalho → Logística.
- A migration `066_google_reviews.sql` cria a configuração OAuth do Google Business Profile e os campos do agente de respostas de avaliações.
- O `.gitignore` protege `.env*`, `docs/orcamento/simulacao/` e `WACRM-MVISION.md`, que pode conter continuidade e segredos de produção.
