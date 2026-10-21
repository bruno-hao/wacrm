# Próximos passos — modelo de orçamento M Vision

Estado em 2026-10-21 (commit base `4a820c4`).

## Já em produção
- ZapÓtica: Avisos, Pós-Venda, Receitas Vencidas, Aniversário.
- Página Orçamentos (`src/app/(dashboard)/orcamentos/page.tsx`): combobox de orçamentos ativos do ssOtica.
- Seleção e encaminhamento de mensagens no inbox.

## Em andamento: modelo de orçamento (`docs/orcamento`)
- `template-src.html` → `modelo-orcamento.html` (1, 2 ou 3 opções) e `modelo-orcamento-opcao-unica.html`.
- `gerar_simulacao.py` e `gerar_trio.py` geram HTML/PDF por orçamento do ssOtica.
- Logos dos fabricantes em `logos/`; logo da loja em `logo-mvision.png`.
- `docs/orcamento/simulacao/` é gitignored (dados de clientes reais). Existe só no Windows de quem gerou; não está no repositório.
- Os PDFs foram gerados com Edge headless (`msedge --print-to-pdf`), que não existe na nuvem nem no container de produção.

## Próximo passo
Ligar o modelo à página Orçamentos: escolher orçamento ativo → montar 1, 2 ou 3 opções → gerar PDF.

Proposta (a confirmar):
- Componente React que renderiza o modelo com os dados do orçamento; botão "Gerar PDF" usa `window.print()` com CSS `@page` A4 (sem Chromium no servidor).
- Rota de API só para buscar dados do orçamento/opções, com `requireRole` e filtro por `account_id`.
- Logos movidos/copiados para `public/`.
- Alternativa: PDF no servidor (exige Chromium na imagem Docker, que fica bem maior).
- Pendente de decidir: de onde vêm as 1–3 opções (modelos de lente escolhidos na tela; o seletor de modelo foi removido da página).

## Atenção
- Credenciais (login web do ssOtica, `ENCRYPTION_KEY`, tokens) ficam só no servidor/Supabase, nunca no repositório.
- Migrations aplicadas até a 061; aplicar manualmente no Supabase antes de deploy que use colunas novas.
- Build de produção: workflow "Publish image (GHCR)" + `docker compose pull && docker compose up -d` na VPS.
- Strings novas de UI vão nos quatro catálogos (`messages/*.json`); rotas novas em `(dashboard)` entram em `protectedPaths`.
