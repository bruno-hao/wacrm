# Política de Segurança

Obrigado por dedicar seu tempo a investigar a segurança deste template.

## Reportando uma vulnerabilidade

**Não abra uma issue pública no GitHub para bugs de segurança.** As issues
públicas são indexadas por mecanismos de busca e vistas por todos os forks
muito antes de a correção do upstream chegar.

Em vez disso, reporte de forma privada por uma das vias:

- [GitHub Security Advisories](https://github.com/ArnasDon/wacrm/security/advisories/new)
  (preferida — mantém a divulgação, a correção e o CVE num só lugar).
- E-mail: `a.donauskas@hostinger.com` com `[CRM template security]` no assunto.

Inclua, se puder:

- Uma descrição do problema e do impacto.
- Passos de reprodução ou uma prova de conceito.
- O commit ou a versão contra a qual você está testando.
- Se deseja crédito na divulgação final (por padrão damos crédito pelo nome
  ou handle que você nos informar, a menos que prefira o anonimato).

## O que esperar

- **Confirmação de recebimento** em até 72 horas.
- **Avaliação inicial** (gravidade, versões afetadas, se existe uma
  solução alternativa) em até uma semana.
- **Correção + divulgação coordenada** num prazo proporcional à gravidade.
  Problemas críticos recebem um patch assim que houver um pronto; problemas
  médios entram junto com o próximo release.

## Escopo

Dentro do escopo:
- Qualquer coisa neste repositório (`ArnasDon/wacrm`), incluindo fluxos de
  webhook e autenticação, criptografia de tokens, políticas de RLS e os
  endpoints de cron embutidos.
- Configurações padrão distribuídas em `docs/` — por exemplo, se o guia de
  configuração deixar um padrão inseguro.

Fora do escopo:
- Vulnerabilidades no Supabase, Next.js, Node.js ou outras dependências do
  upstream — reporte-as aos respectivos mantenedores. Atualizaremos as
  versões com prazer, mediante pedido.
- Problemas que exijam uma implantação previamente comprometida (por
  exemplo, uma chave service-role vazada), a menos que ampliem o raio de
  impacto além do comprometimento inicial.
- Engenharia social, ataques físicos ou serviços de terceiros que o seu
  fork adicionar após o deploy.

## Safe harbor (porto seguro)

A pesquisa conduzida sob esta política é autorizada. Não tomaremos medidas
legais contra quem:

- Fizer um esforço de boa-fé para evitar destruição de dados, violações de
  privacidade ou interrupção do serviço.
- Nos der um prazo razoável para responder antes de qualquer divulgação
  pública.
- Não explorar o problema além do necessário para demonstrá-lo.

Obrigado por ajudar a manter este template (e seus forks) seguro.
