# Várias contas do WhatsApp Business em uma mesma implantação do wacrm

A issue #500 perguntou como uma implantação pode atender contas cujos
números pertencem a diferentes WhatsApp Business Accounts (WABAs), dado que
`META_APP_SECRET` e `META_APP_ID` são variáveis de ambiente válidas para
toda a implantação. Resposta curta: os WABAs já são por conta; apenas o
*App* da Meta é da implantação inteira, e desde a #500 o webhook aceita
vários segredos de app. Esta página percorre as três configurações.

## O que é por conta e o que é por implantação

| Valor | Fica em | Escopo |
| --- | --- | --- |
| Phone Number ID, WABA ID, token de acesso, verify token, PIN de duas etapas | `whatsapp_config` (uma linha por conta do wacrm, token criptografado) | por conta |
| URL de callback do webhook | seu App da Meta → WhatsApp → Configuration | por App da Meta |
| `META_APP_SECRET` | ambiente do servidor | por implantação — **pode listar vários** |
| `META_APP_ID` | ambiente do servidor | por implantação — valor único |

A Meta assina cada entrega de webhook com o segredo do App ao qual o WABA
está inscrito. O wacrm confere essa assinatura contra `META_APP_SECRET`
antes de olhar o corpo e então encaminha o payload para a conta cuja linha
contém o `phone_number_id` da entrega.

## Configuração A — várias contas, um App da Meta, vários WABAs (funciona de fábrica)

Este é o caso normal de uma agência ou de uma empresa com várias marcas.
Nada a configurar além de uma instalação single-tenant.

1. Crie um App da Meta e adicione o produto WhatsApp. Em
   **WhatsApp → Configuration**, defina a URL de callback como
   `https://<seu host>/api/whatsapp/webhook` e inscreva-se no campo
   `messages`. Defina `META_APP_SECRET` com o segredo deste app.
2. Para cada WABA, garanta que o portfólio empresarial (Business) que o
   possui tenha acesso ao app (Business Settings → Accounts → WhatsApp
   accounts → Assigned assets, ou adicione o WABA pelo produto WhatsApp do
   app).
3. Cada conta do wacrm abre Configurações → Conexão do WhatsApp e informa o
   seu próprio Phone Number ID, WABA ID, um token de acesso de System User
   capaz de gerenciar *aquele* WABA, um verify token e (para números de
   produção) o PIN de duas etapas.

Ao salvar, o wacrm verifica o número com o token, registra-o
(`POST /{phone_number_id}/register`, PIN obrigatório) e inscreve o WABA no
app (`POST /{waba_id}/subscribed_apps`). A partir daí a Meta entrega os
eventos de todos os WABAs na única URL de callback e o wacrm os distribui
por `phone_number_id`.

Restrições:

* Um número de telefone só pode ser conectado a uma conta do wacrm — a
  rota recusa um `phone_number_id` já reivindicado por outra conta.
* O **verify token** digitado nas configurações de webhook do App da Meta
  deve ser igual ao verify token salvo por pelo menos uma conta do wacrm; o
  handshake (`GET /api/whatsapp/webhook`) aceita o token de qualquer conta.
  Usar a mesma string em todas as contas simplifica as coisas.

## Configuração B — WABAs sob diferentes Apps da Meta

Às vezes os WABAs não podem compartilhar um app: dois clientes têm cada um
o seu App e portfólio na Meta, ou um app existente não pode receber acesso
ao WABA de outra empresa. Cada app assina os webhooks com o próprio segredo,
então o wacrm precisa de todos eles.

1. Em **todo** App da Meta, defina a mesma URL de callback
   (`https://<seu host>/api/whatsapp/webhook`) e inscreva-se em `messages`.
   Use um verify token que pelo menos uma conta do wacrm tenha salvo (veja
   a observação acima).
2. Defina `META_APP_SECRET` como a lista separada por vírgulas dos segredos
   de todos esses apps:

   ```
   META_APP_SECRET=segredo-do-app-um,segredo-do-app-dois
   ```

   Espaços ao redor das vírgulas são ignorados e posições vazias são
   descartadas. Uma entrega é aceita quando o seu `X-Hub-Signature-256`
   confere com **qualquer** segredo listado; cada comparação é em tempo
   constante. Um valor vazio ou só com vírgulas continua falhando de forma
   fechada — toda requisição é rejeitada.
3. Cada conta do wacrm conecta o seu número exatamente como na
   configuração A, usando um token gerado dentro do portfólio empresarial
   que possui o seu app. Ao salvar, o WABA é inscrito *naquele* app (aquele
   a que o token pertence).

Rotacionando um segredo: adicione o novo à lista, faça o redeploy, então
rotacione na Meta e depois remova o antigo. As entregas continuam sendo
verificadas durante todo o processo.

## Configuração C — o que não é suportado: um App ID da Meta por conta

O `META_APP_ID` é usado para exatamente uma coisa: o Resumable Upload da
Meta quando um template de mensagem tem **cabeçalho de imagem** (o exemplo
do cabeçalho precisa ser um handle de upload com escopo de app, não uma
URL). É um valor único.

Com a configuração B, portanto, o upload de template com cabeçalho de
imagem de cada conta passa pelo único app indicado em `META_APP_ID`,
autenticado com o token da própria conta. Se o token da conta foi gerado
sob o portfólio de outro app, a Meta rejeita o upload e o envio do template
retorna esse erro. Templates somente de texto, envio, recebimento e todo o
resto não são afetados.

Alternativas enquanto não existe um app id por conta:

* Coloque os WABAs que precisam de templates com cabeçalho de imagem sob o
  app indicado em `META_APP_ID`; ou
* Crie os templates com cabeçalho de imagem diretamente no WhatsApp Manager
  — uma vez aprovados, o wacrm os lista e envia como qualquer outro
  template.

Uma coluna `app_id` por conta em `whatsapp_config` resolveria isso; não está
planejada a curto prazo porque o único consumidor é o upload do cabeçalho
de template.

## Verificando uma implantação multi-WABA

* Configurações → Conexão do WhatsApp → **Verificar com a Meta** executa,
  por conta, o diagnóstico verificação a verificação (`phone_metadata_ok`,
  `waba_subscribed_to_app`, `locally_marked_registered`).
  `waba_subscribed_to_app` falso significa que o salvamento não conseguiu
  inscrever o WABA no seu app — informe o token novamente e salve de novo.
* Uma entrega de webhook rejeitada com 401 significa que nenhum segredo
  configurado produziu a sua assinatura — o WABA está inscrito em um app
  cujo segredo não consta em `META_APP_SECRET`.
