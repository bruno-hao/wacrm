# Usando este template

Este é um **repositório template**, não um produto colaborativo. O fluxo
esperado é:

1. Faça um **fork** para a sua conta ou organização no GitHub.
2. **Publique** o fork — veja [`docs/`](./docs/README.md).
3. **Personalize** o seu fork. Aplique sua marca, adicione as
   funcionalidades de que precisa, remova as que não precisa, troque a
   hospedagem, altere o schema.

Você **não** precisa enviar alterações de volta ao upstream. O fato de o
seu fork divergir é justamente o ponto — o upstream é deliberadamente
opinativo quanto a stack, UX e escopo, e o seu fork é onde essas opiniões
passam a ser suas.

## Fork e execução

```bash
# 1. Faça o fork no GitHub: https://github.com/ArnasDon/wacrm → Fork
# 2. Clone o seu fork
git clone https://github.com/<seu-usuario>/wacrm.git
cd wacrm

cp .env.local.example .env.local   # preencha as credenciais do Supabase + Meta
npm install
npm run dev
```

A configuração completa (migrations do Supabase, API do WhatsApp Business,
deploy) está em [`docs/`](./docs/README.md).

## Mantendo o seu fork atualizado

Traga periodicamente as correções de bugs e patches de segurança do upstream:

```bash
git remote add upstream https://github.com/ArnasDon/wacrm.git  # uma vez
git fetch upstream
git checkout main
git merge upstream/main     # ou: git rebase upstream/main
# Resolva eventuais conflitos (provavelmente nas áreas que você personalizou) e faça push
git push origin main
```

Se você fez muitas personalizações locais, o rebase pode gerar conflitos a
cada atualização. Fixar uma tag específica do upstream e atualizar no seu
ritmo é uma alternativa válida.

## Reportando bugs no template upstream

Se você encontrar um bug no código do upstream — e não em algo que você
introduziu no seu fork — registre-o usando o template de
[relato de bug](https://github.com/ArnasDon/wacrm/issues/new?template=bug_report.yml).
Incluir o SHA do commit, o ambiente de execução (Hostinger / Vercel /
local / outro) e os logs leva à correção mais rápido.

## Reportando problemas de segurança

**Não registre problemas de segurança publicamente.** Siga o fluxo privado
em [SECURITY.md](./.github/SECURITY.md).

## Pull requests para o upstream

Não é o fluxo principal, mas são bem-vindos em casos específicos:

- **Correções de segurança** — sempre bem-vindas; siga primeiro o
  SECURITY.md para a divulgação.
- **Correções de bugs** alinhadas à intenção do upstream (crash,
  correção de comportamento, erros de documentação, erros de digitação) —
  entram rápido.
- **Pequenas melhorias** (acessibilidade, detalhes óbvios de UX) — em geral
  bem-vindas; abra uma issue antes para verificar o alinhamento.

Menos prováveis de serem aceitas:

- **Novas funcionalidades.** O escopo do template é intencionalmente
  estreito. Uma "ótima ideia para um CRM" costuma ser uma ótima ideia para o
  *seu* CRM — isto é, o seu fork — mas diluiria o template para o próximo
  usuário.
- **Mudanças de stack** (outro ORM, outro kit de UI, outro provedor de
  autenticação). Isso pertence a um fork, não ao upstream.
- **Refatorações opinativas** sem uma motivação concreta de correção ou
  desempenho.

Se você enviar um PR, valem as regras de sempre:

- Crie a branch a partir da `main` mais recente (não faça push em uma
  branch já mesclada — os commits ficam órfãos).
- Rode `npm run typecheck` e `npm run format` localmente antes.
- Preencha o template do PR, especialmente o **Plano de testes**.
- Uma mudança lógica por PR.
- A primeira linha da mensagem de commit é imperativa e concisa; o corpo
  explica o *porquê*, o diff mostra o *quê*.

Espere uma revisão em alguns dias. PRs abertos sem uma issue podem ser
fechados — abra primeiro a issue para alinhar.

## Se você mantém um fork público

- Troque a marca. O nome "CRM Template for WhatsApp", o favicon e a URL
  `wacrm.tech` pertencem ao projeto upstream; substitua-os pelos seus antes
  de colocar a sua implantação diante de usuários.
- Mantenha o arquivo [`LICENSE`](./LICENSE) MIT — é assim que as permissões
  do template acompanham o código. Uma atribuição em uma seção do `README`
  é apreciada, mas não obrigatória.
- Você é livre para relicenciar as adições ao seu fork como quiser.

## Referência do ciclo de desenvolvimento

Mesmo que você nunca envie um PR ao upstream, estes são os scripts que você
usará no seu fork:

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com Turbopack na porta 3000. |
| `npm run build` | Build de produção. O Next também roda o próprio typecheck aqui. |
| `npm run typecheck` | `tsc --noEmit`. Verificação rápida apenas de TS. |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier gravando as alterações. |
| `npm run format:check` | Prettier apenas em modo de verificação. Útil no CI. |

## Licenciamento

Este template é MIT ([`LICENSE`](./LICENSE)). Tudo o que você contribuir
para o upstream é presumido como MIT também. As adições do seu fork são
suas para licenciar como quiser.
