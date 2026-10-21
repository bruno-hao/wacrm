# Executando com Docker

O repositório inclui um `Dockerfile` multi-stage (saída standalone do
Next.js, executado como usuário não-root) e um `docker-compose.yml` com um
único serviço `app`. O Supabase é externo — aponte o app para o seu projeto
Supabase hospedado (ou self-hosted) por meio de variáveis de ambiente; não
há container de banco de dados incluído.

## Início rápido

1. Copie o template de variáveis de ambiente e preencha:

   ```bash
   cp .env.local.example .env.local
   ```

2. Faça o build e suba (a flag `--env-file` é obrigatória — o Compose só
   lê o `.env` por padrão para a substituição de `${VAR}`, e este projeto
   mantém a configuração em `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. O app é servido em [http://localhost:3000](http://localhost:3000)
   (publique em outra porta com `HOST_PORT=8080` no `.env.local`).

> Use `HOST_PORT`, e não `PORT`, para mudar a porta publicada. `PORT` é a
> porta em que o servidor escuta _dentro_ do container, e o `env_file` a
> injetaria lá — deixando o app numa porta que o mapeamento e o healthcheck
> não apontam. O Compose a fixa em 3000 por esse motivo.

## Variáveis de build vs. de runtime

- As variáveis `NEXT_PUBLIC_*` são **embutidas no bundle do cliente em
  tempo de build**. Elas são passadas como build args do Docker pelo
  `docker-compose.yml`. Se alterar alguma, refaça o build:
  `docker compose --env-file .env.local up --build -d`. Isso inclui
  `NEXT_PUBLIC_APP_LOCALE` (`en | ko | pt | es`), portanto o idioma da
  interface é fixo por imagem.
- Todo o resto (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) é lido em **runtime** do `.env.local` via
  `env_file` e nunca é embutido na imagem — pode ser alterado apenas
  reiniciando o container.

## Docker puro (sem Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## Observações

- As migrations de banco em `supabase/` **não** são executadas pelo
  container — aplique-as com a CLI do Supabase, como descrito no README.
- Os anexos recebidos são copiados para o bucket `chat-media` do Supabase
  Storage, porque a Meta apaga a mídia cerca de 30 dias após a chegada e a
  cópia é a única coisa que sobrevive a isso. Ele cresce com o volume de
  entrada, então vale acompanhar a cota de armazenamento do seu projeto.
  Desative por conta em Configurações → WhatsApp → Armazenamento de
  anexos; anexos recebidos enquanto estiver desativado deixam de poder ser
  visualizados quando a Meta os descartar. Arquivos acima de 16 MB (o
  limite do bucket) nunca são copiados.
- Nada dentro do container é agendado. Se você usa passos de Espera de
  automações ou fluxos, aponte um agendador externo para
  `GET /api/automations/cron` e `GET /api/flows/cron` desta implantação,
  enviando o segredo compartilhado no header `x-cron-secret`
  (`AUTOMATION_CRON_SECRET`, veja `.env.local.example`). Ambos retornam 503
  até que essa variável seja definida.
