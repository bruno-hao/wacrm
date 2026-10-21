# wacrm — Template de CRM para WhatsApp

> Template de CRM para WhatsApp® que você hospeda por conta própria — caixa
> de entrada compartilhada, contatos, funis de vendas, disparos em massa e
> automações sem código. Faça um fork, aplique sua marca, hospede.

<p align="center">
  <a href="https://www.hostinger.com/web-apps-hosting?REFERRALCODE=WACRMHOST">
    <img src="./.github/assets/hostinger-deploy.png" alt="Publique seu app Node.js com um clique — Deploy na Hostinger" width="900">
  </a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/ArnasDon/wacrm/actions/workflows/ci.yml/badge.svg)](https://github.com/ArnasDon/wacrm/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![Stars](https://img.shields.io/github/stars/ArnasDon/wacrm?style=social)](https://github.com/ArnasDon/wacrm/stargazers)

O site institucional e a documentação de self-host ficam em outro repositório:
[ArnasDon/wacrm-site](https://github.com/ArnasDon/wacrm-site)
([wacrm.tech](https://wacrm.tech)). Este repositório é o produto —
clone ou faça um fork para rodar o seu próprio CRM.

## O que você recebe de fábrica

- **Caixa de entrada compartilhada** na API oficial do WhatsApp Business —
  vários atendentes em um mesmo número, atribuição por conversa, status e
  notas.
- **Contatos + tags + campos personalizados**, importação de CSV,
  deduplicação.
- **Funis de vendas** (Kanban) com negócios vinculados às conversas.
- **Disparos em massa** com templates aprovados pela Meta, acompanhamento
  de entrega e leitura, substituição de variáveis por destinatário.
- **Automações sem código** — gatilhos em mensagens recebidas, novos
  contatos, palavras-chave ou agendamento; ramificações condicionais,
  esperas, tags, webhooks. Construtor visual.
- **Assistente de respostas com IA** — traga sua própria chave da OpenAI
  ou da Anthropic (armazenada criptografada; sem cobrança de IA por
  usuário, seus dados continuam seus). Respostas rascunhadas por IA com um
  clique na caixa de entrada, além de um bot de resposta automática
  opcional, com limite por conversa e transferência limpa para um humano.
  Adicione uma **base de conhecimento** (FAQs, políticas, documentação de
  produtos) e ele responde a partir do seu próprio conteúdo — recuperação
  híbrida (full-text do Postgres ou pgvector semântico quando há uma chave
  de embeddings).
- **Dashboard em tempo real** — tempos de resposta, volume diário, valor do
  funil, feed de atividades entre módulos.
- **Contas de equipe** — convide colegas por link, acesso baseado em papéis
  (owner / admin / agent / viewer), transferência de propriedade. Toda
  instalação é isolada por conta, então uma caixa de entrada compartilhada
  pode ser atendida por uma equipe inteira. O uso individual continua com
  um único usuário e zero configuração.
- **Gerenciamento de conta** — e-mail, senha, avatar, logout global.
- **API REST pública** (`/api/v1`) com chaves de API com escopo e
  revogáveis — construa suas próprias automações em cima do seu CRM. Veja
  [docs/public-api.md](./docs/public-api.md).
- **Servidor MCP** — controle seu CRM pelo Claude, Cursor e outros
  assistentes de IA via [Model Context Protocol](https://modelcontextprotocol.io).
  Somente leitura por padrão, escrita sob adesão. Veja
  [docs/mcp.md](./docs/mcp.md) (servidor em [`mcp-server/`](./mcp-server)).

## Por que fazer um fork?

Isto é um **template**, não um produto. Fazer um fork significa que você tem:

- **Propriedade total** — seu código, seu projeto Supabase, seu domínio,
  seus dados. Sem lock-in de SaaS, sem preço por usuário, sem dança de
  confiança.
- **Personalização total** — adicione os campos que sua equipe precisa,
  remova os módulos que não quer, redesenhe o que for. A stack é
  propositalmente simples (Next.js + Supabase + Tailwind), então a curva de
  aprendizado é curta.
- **Zero operação para começar** — o Node.js gerenciado da
  [Hostinger](https://www.hostinger.com/web-apps-hosting?REFERRALCODE=WACRMHOST)
  publica um fork em poucos cliques. Sem Docker, sem Kubernetes, sem
  precisar de time de infraestrutura.
  ([Veja abaixo ↓](#-deploy-na-hostinger-recomendado))
- **Primitivas de segurança de verdade** — criptografia de tokens
  (AES-256-GCM), RLS em todas as tabelas, webhooks verificados por HMAC,
  CSP, limitação de taxa, typecheck/build no CI a cada PR.

Não é um framework. Não é um SDK. É um CRM concreto e funcional que você
coloca de pé numa tarde e faz seu.

## Início rápido

```bash
# Faça o fork no GitHub primeiro: https://github.com/ArnasDon/wacrm → Fork
git clone https://github.com/<seu-usuario>/wacrm.git
cd wacrm
npm install
cp .env.local.example .env.local   # preencha as credenciais do Supabase + Meta
npm run dev
```

Abra <http://localhost:3000>. Você será redirecionado para `/login` (ou
para `/dashboard`, se já estiver autenticado).

A interface vem em inglês, coreano, português do Brasil e espanhol — defina
`NEXT_PUBLIC_APP_LOCALE` como `en`, `ko`, `pt` ou `es` no `.env.local`
(os catálogos ficam em `messages/`).

Prefere containers? Veja [docs/docker.md](./docs/docker.md) para a
configuração com Dockerfile + Docker Compose.

## 🚀 Deploy na Hostinger (recomendado)

<p align="center">
  <a href="https://www.hostinger.com/web-apps-hosting?REFERRALCODE=WACRMHOST">
    <img src="./.github/assets/hostinger-deploy.png" alt="Publique seu app Node.js com um clique — Deploy na Hostinger" width="1000">
  </a>
</p>
<p align="center">
  <a href="https://wacrm.tech/docs/deployment-hostinger">
    <img src="https://img.shields.io/badge/Guia_passo_a_passo-wacrm.tech%2Fdocs-111?style=for-the-badge" alt="Guia passo a passo" height="44">
  </a>
</p>

**O wacrm foi feito para rodar na [Hostinger](https://www.hostinger.com/web-apps-hosting?REFERRALCODE=WACRMHOST).**
É o caminho que testamos, documentamos e recomendamos — e a forma mais
rápida de colocar um CRM de nível de produção no ar sem ter um VPS ou um
cluster Kubernetes.

### Por que a Hostinger?

| | |
|---|---|
| **Deploy por Git com um clique** | Conecte seu fork, faça push na `main` e a Hostinger compila e publica. Sem SSH, sem Docker, sem CI para configurar — a própria `main` deste repositório é publicada assim. |
| **Node.js gerenciado** | O Next.js 16 (App Router, server actions, ISR) roda direto nos planos compartilhados [Premium, Business e Cloud](https://www.hostinger.com/web-apps-hosting?REFERRALCODE=WACRMHOST). Você não gerencia versões do Node, processos nem proxies reversos. |
| **SSL e domínio grátis** | Let's Encrypt automático no seu domínio próprio (ou um domínio grátis incluído nos planos anuais). HTTPS vem ativado — exigido pelo webhook do WhatsApp Business. |
| **CDN global + LiteSpeed** | Ativos estáticos em cache na borda, rotas dinâmicas servidas pelo LiteSpeed. Dashboards ágeis de fábrica, sem configurar Cloudflare. |
| **Variáveis de ambiente e logs no hPanel** | Defina `SUPABASE_*`, `WHATSAPP_*` e `ENCRYPTION_KEY` pelo painel — sem `.env` no servidor. Logs da aplicação ao vivo na mesma interface. |
| **Proteção DDoS + backups diários** | Já incluídos, sem complementos. O endpoint do webhook é um alvo público — ter proteção na borda importa. |
| **Mais barato que um VPS** | Os planos começam em poucos dólares por mês — uma ordem de grandeza abaixo de um host Node.js gerenciado comparável, e você não paga a mais pelo banco de dados (esse é o Supabase). |
| **Suporte humano 24/7** | Suporte por chat ao vivo em mais de 20 idiomas — útil quando o seu CRM é o que sua equipe usa para falar com os clientes. |

### A versão de 60 segundos

1. Faça o **fork** deste repositório no GitHub.
2. No **hPanel → Websites → Create**, escolha **Node.js** e conecte seu
   fork.
3. Cole suas variáveis de ambiente do Supabase + Meta no hPanel.
4. Faça push na `main`. A Hostinger compila e publica. Pronto.

Passo a passo completo com capturas de tela:
**[wacrm.tech/docs/deployment-hostinger](https://wacrm.tech/docs/deployment-hostinger)**.

> _Nota: o wacrm tem licença MIT e roda em qualquer lugar onde o Node.js
> rode (Vercel, Railway, seu próprio VPS). A Hostinger é recomendada, não
> obrigatória._

## Documentação

A documentação completa de self-host — migrations do Supabase, configuração
da API do WhatsApp Business e deploy em produção — está em
**[wacrm.tech/docs](https://wacrm.tech/docs)**
(código-fonte: [ArnasDon/wacrm-site](https://github.com/ArnasDon/wacrm-site)).

Páginas principais:
- [Primeiros passos](https://wacrm.tech/docs/getting-started)
- [Configuração do Supabase](https://wacrm.tech/docs/supabase-setup)
- [Configuração do WhatsApp](https://wacrm.tech/docs/whatsapp-setup)
- [Variáveis de ambiente](https://wacrm.tech/docs/environment-variables)
- [Deploy na Hostinger](https://wacrm.tech/docs/deployment-hostinger)
- [Arquitetura](https://wacrm.tech/docs/architecture)
- [Solução de problemas](https://wacrm.tech/docs/troubleshooting)
- [Solução de problemas na conexão do WhatsApp](./docs/whatsapp-connection-troubleshooting.md)
  — o que significa cada erro de "Salvar configuração" e o código da Meta /
  trace id a informar ao suporte da Meta
- [Vários WABAs em uma mesma implantação](./docs/multi-waba.md) — um app da
  Meta ou vários; como o `META_APP_SECRET` aceita uma lista separada por
  vírgulas
- [E-mails de autenticação](./docs/auth-emails.md) — o que o Supabase
  precisa permitir para que os links de confirmação e redefinição de senha
  voltem para o *seu* domínio em vez de `localhost:3000`, e como o
  `/auth/callback` os trata

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Dados** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (API oficial do WhatsApp Business).

## Contribuindo

Isto é um template, não um produto colaborativo — o fluxo esperado é
fork → personalizar → publicar, **não** contribuir de volta ao upstream.
Relatos de bugs e problemas de segurança são bem-vindos; PRs de novas
funcionalidades geralmente pertencem ao seu fork, e não a este repositório.
Detalhes em [`CONTRIBUTING.md`](./CONTRIBUTING.md) e
[`.github/SECURITY.md`](./.github/SECURITY.md).

## Licença

[MIT](./LICENSE). Faça um fork, aplique sua marca, hospede.
