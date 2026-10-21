# Servidor MCP do wacrm

Um servidor [Model Context Protocol](https://modelcontextprotocol.io) para o
**[wacrm](https://github.com/ArnasDon/wacrm)** — o CRM de WhatsApp que você
hospeda por conta própria. Ele permite que clientes MCP (Claude Desktop,
Claude Code, Cursor e outros) controlem o seu CRM em linguagem natural:

> "Quantas conversas ainda estão abertas?"
> "Encontre o contato de +1 415 555 0123 e mostre as últimas mensagens."
> "Redija e envie um template de atualização de pedido para a Jane."

É um wrapper fino sobre a API REST pública [`/api/v1`](../docs/public-api.md)
do wacrm. Toda a autenticação, escopo e limite de taxa são aplicados pela
sua instância do wacrm — este servidor apenas expõe a API como ferramentas
MCP.

## Pré-requisitos

1. Uma instância do wacrm em execução (a sua própria implantação
   self-hosted).
2. Uma chave de API: no dashboard, vá em **Configurações → Chaves de API →
   Nova chave de API** e conceda apenas os escopos de que precisa. A chave
   é exibida uma única vez.

## Instalação e configuração

O servidor lê duas variáveis de ambiente obrigatórias e duas travas de
escrita opcionais:

| Variável                  | Obrigatória | Finalidade                                                         |
| ------------------------- | ----------- | ------------------------------------------------------------------ |
| `WACRM_BASE_URL`          | sim         | A URL da sua instância, ex.: `https://crm.example.com`             |
| `WACRM_API_KEY`           | sim         | Uma chave de API do dashboard                                      |
| `WACRM_ENABLE_WRITES`     | não         | `true` para expor escrita de contatos + envio de mensagens         |
| `WACRM_ENABLE_BROADCASTS` | não         | `true` para expor disparos em massa (exige `WACRM_ENABLE_WRITES`)  |

### Claude Desktop / Claude Code / Cursor

Adicione à configuração do seu cliente MCP (ex.: `claude_desktop_config.json`
ou `.mcp.json` no Claude Code):

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

Essa configuração é **somente leitura** — o padrão seguro. Para permitir
que o assistente altere dados ou envie mensagens, adicione as travas de
escrita:

```jsonc
"env": {
  "WACRM_BASE_URL": "https://crm.example.com",
  "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx",
  "WACRM_ENABLE_WRITES": "true",
  "WACRM_ENABLE_BROADCASTS": "true"
}
```

## Ferramentas

As ferramentas de leitura estão sempre disponíveis. As de escrita e de
disparo em massa só aparecem quando a respectiva trava está definida.

| Ferramenta           | Grupo     | Escopo necessário    | O que faz                                              |
| -------------------- | --------- | -------------------- | ------------------------------------------------------ |
| `whoami`             | leitura   | _(qualquer chave válida)_ | Mostra a conta + escopos que a chave possui       |
| `list_contacts`      | leitura   | `contacts:read`      | Lista/busca contatos (paginado)                        |
| `get_contact`        | leitura   | `contacts:read`      | Lê um contato                                          |
| `list_conversations` | leitura   | `conversations:read` | Lista conversas, filtrando por status/contato          |
| `get_conversation`   | leitura   | `conversations:read` | Lê uma conversa                                        |
| `list_messages`      | leitura   | `messages:read`      | Lista as mensagens de uma conversa                     |
| `get_broadcast`      | leitura   | `broadcasts:send`    | Consulta o status de entrega de um disparo             |
| `send_message`       | escrita   | `messages:send`      | Envia uma mensagem de WhatsApp (texto/template/mídia)  |
| `create_contact`     | escrita   | `contacts:write`     | Cria (localiza ou cria) um contato                     |
| `update_contact`     | escrita   | `contacts:write`     | Atualiza um contato / substitui suas tags              |
| `send_broadcast`     | disparo   | `broadcasts:send`    | Inicia um disparo de template (exige `confirm`)        |

## Modelo de segurança

Enviar mensagens de WhatsApp por meio de um LLM é um efeito colateral no
mundo real, então o servidor aplica três travas em camadas:

1. **Somente leitura por padrão.** As ferramentas de escrita e de disparo
   nem sequer são registradas — o modelo não as enxerga — a menos que você
   adira via `WACRM_ENABLE_WRITES` / `WACRM_ENABLE_BROADCASTS`.
2. **Escopos da chave de API.** Seja o que as travas permitirem, a sua
   instância do wacrm ainda aplica os escopos da chave. Uma chamada sem o
   escopo certo retorna um erro `forbidden` limpo. Emita uma chave somente
   leitura para um assistente somente leitura.
3. **Confirmação explícita de disparo.** `send_broadcast` se recusa a
   executar a menos que seja chamada com `confirm: true`, e é marcada como
   `destructive` para que clientes compatíveis perguntem ao usuário antes.

## Desenvolvimento

```bash
npm install
npm run build      # compila para dist/
npm run typecheck
npm start          # executa o servidor compilado (precisa das variáveis de ambiente)
```

Os logs vão para o **stderr** — o stdout é reservado para o protocolo MCP.

## Licença

MIT — igual ao wacrm.
