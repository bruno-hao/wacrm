# E-mails de autenticação: links de confirmação e redefinição de senha

O wacrm usa o Supabase Auth para cadastro, login e redefinição de senha.
Dois desses fluxos enviam um e-mail com um link, e o link precisa voltar
para a **sua** implantação. Esta página explica como o app pede isso, o que
é preciso informar ao Supabase para que ele cumpra, e como são os sintomas
quando não cumpre.

## O que o app faz

Todo link enviado por e-mail é solicitado para voltar à origem do próprio
app em `/auth/callback`, que troca o link por uma sessão e então
encaminha para a página de que o fluxo precisa:

| Fluxo | Iniciado em | O link volta para |
|---|---|---|
| Confirmação de e-mail após o cadastro | `/signup` | `/auth/callback?next=/dashboard` (ou `/join/<token>` ao se cadastrar a partir de um convite) |
| Redefinição de senha | `/forgot-password` | `/auth/callback?next=/reset-password` |

"A origem do próprio app" é a origem de onde o navegador carregou a página
(`window.location.origin`) — `https://crm.example.com` em produção,
`http://localhost:3000` no desenvolvimento local. Nenhuma variável de
ambiente está envolvida.

O `/auth/callback` aceita os dois formatos de link que o Supabase pode
produzir — o `?code=` padrão (PKCE) e `?token_hash=&type=` de um template
personalizado — valida o `next` para que só possa apontar para um caminho
de mesma origem, e redireciona com um `Location` *relativo*, de modo que
funciona sem alterações atrás de Cloudflare Tunnel, nginx, Hostinger,
Vercel ou qualquer outro proxy.

## O que o Supabase precisa

O Supabase só respeita um redirecionamento solicitado quando ele consta na
lista de permissão de **Redirect URLs**. Caso contrário, ele **volta
silenciosamente para a Site URL**, cujo padrão é `http://localhost:3000`.
Esse fallback é a história inteira por trás de "o link de confirmação
aponta para localhost".

### Supabase hospedado (supabase.com)

Dashboard → **Authentication → URL Configuration**:

1. **Site URL** — a origem de produção, por exemplo `https://crm.example.com`.
2. **Redirect URLs** — adicione um curinga para cada origem em que o app roda:

   ```text
   https://crm.example.com/**
   http://localhost:3000/**
   ```

   O `/**` é importante: o redirecionamento do app carrega um caminho e uma
   query string (`/auth/callback?next=…`), que uma entrada apenas com a
   origem não cobre.

As alterações valem imediatamente, mas um e-mail já enviado mantém o link
com que foi enviado — solicite um novo para testar.

### Supabase self-hosted (Docker)

A página do Studio em **Authentication → URL Configuration não persiste as
configurações** em uma stack self-hosted; o serviço de autenticação
(GoTrue) as lê do ambiente. No `.env` ao lado do seu `docker-compose.yml`:

```env
SITE_URL=https://crm.example.com
ADDITIONAL_REDIRECT_URLS=https://crm.example.com/**,http://localhost:3000/**
```

(Configurações mais antigas usam os nomes `GOTRUE_SITE_URL` e
`GOTRUE_URI_ALLOW_LIST`.) Reinicie o container de autenticação depois. Uma
stack self-hosted cujo `.env` ainda tem o `SITE_URL=http://localhost:3000`
de exemplo produz exatamente o sintoma descrito na
[issue #595](https://github.com/ArnasDon/wacrm/issues/595).

### Supabase CLI local (`supabase start`)

O `supabase/config.toml` deste repositório existe apenas para o job de CI
de migrations e deliberadamente não tem seção `[auth]`. Se você roda a
stack local, adicione:

```toml
[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/**"]
```

## Abrindo o link em outro dispositivo

O fluxo padrão é PKCE: o navegador que *solicitou* o e-mail guarda em um
cookie um code verifier de uso único, e o `/auth/callback` precisa dele
para concluir a troca. Abra o link em outro dispositivo ou navegador e o
callback cai em `/login` com uma mensagem dizendo que o link não pôde ser
usado. Duas coisas a saber:

- **A confirmação de e-mail ainda assim foi concluída.** O Supabase
  verificou o endereço antes de redirecionar; o usuário pode simplesmente
  fazer login.
- **A redefinição de senha precisa ser concluída no mesmo navegador** de
  onde foi solicitada — ou solicite um novo link lá.

Para tornar os links independentes de dispositivo, troque os templates de
e-mail do Supabase (**Authentication → Email Templates**) para a forma com
token-hash, que o `/auth/callback` também aceita:

```html
<!-- Confirmar cadastro -->
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard">Confirme seu e-mail</a>

<!-- Redefinir senha -->
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Redefina sua senha</a>
```

Esses links são montados a partir da **Site URL**, então essa configuração
precisa ser a sua origem de produção.

## Sintomas → causas

| O que você vê | Causa provável |
|---|---|
| O link no e-mail é `http://localhost:3000…` em produção | Site URL ainda no padrão e/ou sua origem ausente das Redirect URLs (veja acima). No self-hosted: `SITE_URL` no `.env` do Docker. |
| O link aponta para o domínio certo mas dá 404 | Você está em um build anterior ao que adicionou `/auth/callback` e `/reset-password`. Atualize o seu fork. |
| `/login` diz que o link expirou | Os links são de uso único e têm tempo limitado (padrão do Supabase: 1 hora para recuperação). Solicite um novo. |
| `/login` diz que o link não pôde ser usado | Aberto em um navegador diferente do que o solicitou (PKCE), ou já utilizado. Veja a seção acima. |
| O link funciona em localhost mas não por túnel/proxy | Não deveria acontecer — o callback redireciona com um `Location` relativo. Verifique se o seu proxy repassa o caminho `/auth/callback` e sua query string intactos. |

## Relacionado

- Os links de convite (`/join/<token>`) são gerados pelo app, não pelo
  Supabase — veja `NEXT_PUBLIC_SITE_URL` e `ALLOWED_INVITE_HOSTS` no
  `.env.local.example`.
- O login em si (`/login`) nunca envolve um link por e-mail.
