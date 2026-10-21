# Servidor MCP

O wacrm inclui um servidor [Model Context Protocol](https://modelcontextprotocol.io)
para que você controle seu CRM por assistentes de IA — Claude Desktop,
Claude Code, Cursor e qualquer outro cliente MCP — em linguagem natural:

> "Quantas conversas ainda estão abertas hoje?"
> "Mostre as últimas cinco mensagens com +1 415 555 0123."
> "Envie o template `order_update` para esse contato."

Ele fica em [`mcp-server/`](../mcp-server) e é publicado no npm como
[`wacrm-mcp`](https://www.npmjs.com/package/wacrm-mcp). Por baixo dos
panos, é um wrapper fino sobre a [API pública](./public-api.md), de modo
que toda requisição é autenticada e limitada pela sua instância exatamente
como qualquer outra chamada de API.

## Início rápido

1. Crie uma chave de API no dashboard: **Configurações → Chaves de API**.
   Conceda apenas os escopos de que o seu assistente precisa (um assistente
   somente leitura só precisa dos escopos `*:read`).
2. Adicione o servidor à configuração do seu cliente MCP:

   ```jsonc
   {
     "mcpServers": {
       "wacrm": {
         "command": "npx",
         "args": ["-y", "wacrm-mcp"],
         "env": {
           "WACRM_BASE_URL": "https://crm.example.com",
           "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx"
         }
       }
     }
   }
   ```

Isso é **somente leitura** — o padrão seguro. Para permitir que o assistente
altere dados ou envie mensagens, adicione `"WACRM_ENABLE_WRITES": "true"`
(e `"WACRM_ENABLE_BROADCASTS": "true"` para envios em massa) em `env`.

## O que ele expõe

- **Leituras (sempre ativas):** `whoami`, contatos (listar/obter), conversas
  (listar/obter), mensagens (listar), status de disparos.
- **Escritas (sob adesão):** enviar uma mensagem, criar/atualizar um contato.
- **Disparos em massa (sob adesão):** iniciar um disparo de template —
  exige um `confirm` explícito e é marcado como destrutivo.

## Segurança

Como enviar mensagens de WhatsApp é um efeito colateral real, o servidor é
**somente leitura até você aderir**, em camada acima dos próprios escopos da
chave de API. Dê ao assistente uma chave somente leitura e uma configuração
somente leitura, e ele fisicamente não consegue enviar nada. Veja o
[README do servidor](../mcp-server/README.md) para a lista completa de
ferramentas e o modelo de segurança.
