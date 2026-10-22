<!-- BEGIN:nextjs-agent-rules -->
# Este NÃO é o Next.js que você conhece

Esta versão tem mudanças incompatíveis — APIs, convenções e estrutura de arquivos podem ser todas diferentes do que consta no seu treinamento. Leia o guia relevante em `node_modules/next/dist/docs/` antes de escrever qualquer código. Preste atenção aos avisos de depreciação.
<!-- END:nextjs-agent-rules -->

## Fluxo padrão de commit e publicação

Quando o usuário pedir para fazer um commit, trate o pedido como autorização para executar o fluxo completo de produção, nesta ordem:

1. validar e criar o commit local;
2. enviar o commit ao repositório Git remoto;
3. executar e acompanhar até o fim o workflow `publish-image.yml`, que publica a imagem no GHCR;
4. somente após o workflow concluir com sucesso, conectar à VPS `crm.oticamvision.com.br` por SSH na porta `22022`, atualizar a imagem e recriar o contêiner com `docker compose pull && docker compose up -d` em `/root/wacrm`;
5. confirmar que o contêiner está saudável e que a imagem executada corresponde à imagem publicada.

Se qualquer etapa falhar, não avance para as seguintes. Informe o erro e o ponto exato em que o fluxo parou. Não é necessário pedir nova confirmação entre essas etapas quando o pedido original for para fazer o commit.
