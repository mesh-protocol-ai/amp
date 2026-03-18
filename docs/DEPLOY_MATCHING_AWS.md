# Matching na AWS — fazer o mesh funcionar para consumidores e provedores

Este guia descreve como configurar o **matching na AWS** para que **consumidores** (qualquer pessoa com o token) e **provedores** (registrados no registry) usem o mesh sem rodar matching local.

**Se o consumer dá timeout:** o matching pode não estar subindo porque **`SESSION_TOKEN_SECRET`** não está definido no ambiente (o processo encerra na inicialização). Veja a [seção 8](#8-funcionava-antes-e-parou-timeout).

## Visão geral

- **Consumidores** publicam requests em `mesh.requests.<domain>.<region>` e escutam em `mesh.matches`.
- O **matching** (AWS) escuta `mesh.requests.>`, consulta o **registry**, escolhe um provedor e publica o match em `mesh.matches`.
- **Provedores** escutam `mesh.matches`, recebem o match e aceitam conexões gRPC dos consumidores.

Tudo depende de **NATS**, **Registry** e **Matching** usarem a mesma configuração (mesmo NATS, mesmo registry, mesmo segredo de token de sessão para provedores).

---

## 1. Matching na AWS — variáveis de ambiente

O serviço de matching (Go em `services/matching`) deve rodar na AWS com as seguintes variáveis:

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `NATS_URL` | Sim | URL do NATS que **consumidores e provedores** usam. Ex.: `nats://nats.meshprotocol.dev:4222` ou o endpoint do seu NATS na AWS. |
| `NATS_TOKEN` | Conforme o NATS | Token de autenticação do NATS. Deve ser o **mesmo** que você distribui para consumidores e que os provedores usam. |
| `REGISTRY_URL` | Sim | Base URL do registry onde os provedores se registram. Ex.: `https://api.meshprotocol.dev` ou seu registry na AWS. Deve terminar **sem** barra. |
| `SESSION_TOKEN_SECRET` | Sim | Segredo compartilhado **apenas com os provedores**. O matching gera o token de sessão (HMAC) com esse valor; o provedor valida no handshake (Community / OPEN). Gere um valor forte e guarde em Secrets Manager. |

**Importante:** `NATS_URL` deve incluir o esquema, ex.: `nats://host:4222`. Se usar apenas `host:4222`, o cliente Go pode falhar; prefira `nats://...`.

---

## 2. Mesmo NATS para todos

Consumidores, provedores e matching precisam usar o **mesmo** NATS:

- Se você usa o NATS público (ex.: meshprotocol.dev), o matching na AWS deve conectar com o **mesmo** `NATS_URL` e `NATS_TOKEN` que os usuários.
- Se você tem NATS na AWS, consumidores e provedores devem usar esse endpoint e o token que você definir.

Assim, quando um consumidor publica em `mesh.requests.demo.math.global`, o matching (inscrito em `mesh.requests.>`) recebe a mensagem e publica o match em `mesh.matches`, e o consumidor (inscrito em `mesh.matches`) recebe o match.

---

## 3. Registry — API esperada pelo matching

O matching faz:

```http
GET {REGISTRY_URL}/agents?domain={domain}&capability={capabilityId}
```

Ex.: `GET https://api.meshprotocol.dev/agents?domain=demo,math&capability=calculator`

- O registry deve responder **200** com JSON no formato esperado pelo AMP (lista de agent cards, ex.: `{ "agents": [ ... ] }`).
- Os provedores precisam estar **registrados** nesse registry, com `domain` e `capability` compatíveis com o que os consumidores pedem.

Se o registry for outro (ex.: seu próprio backend), a API e o formato de resposta precisam ser compatíveis com o que o Go em `pkg/agentcard` e `services/matching` esperam.

---

## 4. O que as “pessoas” (consumidores) precisam

Para alguém rodar apenas o **consumer** e receber resposta do mesh:

- **NATS_URL** — o mesmo que o matching usa (ex.: `nats.meshprotocol.dev:4222` ou com esquema).
- **NATS_TOKEN** — o token que você disponibiliza para uso do mesh (ex.: o mesmo do matching).
- **REGISTRY_URL** — o mesmo do matching (ex.: `https://api.meshprotocol.dev`).
- TLS/certs se o provedor usar TLS, conforme o exemplo em `examples/public-mesh-openai-demo` (Community: OPEN, sem chaves Ed25519 no data plane).

Eles **não** precisam de `SESSION_TOKEN_SECRET`.

---

## 5. O que os provedores precisam

Para um provedor receber matches e atender consumidores:

- **NATS_URL** e **NATS_TOKEN** — iguais aos do matching (e aos dos consumidores).
- **REGISTRY_URL** — igual ao do matching; é onde o provedor se registra.
- **SESSION_TOKEN_SECRET** — **o mesmo** que está configurado no matching na AWS. Você deve repassar esse valor de forma segura (ex.: outro secret no Secrets Manager, ou entrega segura ao dono do provedor).
- **DATAPLANE_PUBLIC_ENDPOINT** — URL gRPC onde o consumidor consegue conectar (ex.: `grpcs://meu-provider.aws.com:443`). Se o provedor estiver atrás de um ALB na AWS, use o endpoint do ALB.

Sem o mesmo `SESSION_TOKEN_SECRET`, o handshake no data plane falha (token inválido).

---

## 6. Checklist para “funcionar na infra AWS”

1. **Matching na AWS**
   - [ ] Rodando com `NATS_URL`, `NATS_TOKEN`, `REGISTRY_URL`, `SESSION_TOKEN_SECRET` (ex.: via Secrets Manager / env do ECS/Lambda/EC2).
   - [ ] Consegue conectar no NATS e inscrever em `mesh.requests.>` (ver log: "matching subscribed to mesh.requests.>").

2. **NATS**
   - [ ] Consumidores e provedores usam o **mesmo** `NATS_URL` e `NATS_TOKEN` que o matching.
   - [ ] Firewall/security group permite tráfego na porta do NATS (ex.: 4222) entre clientes e o NATS.

3. **Registry**
   - [ ] Provedores estão registrados nesse registry com domain/capability corretos.
   - [ ] `GET {REGISTRY_URL}/agents?domain=demo,math&capability=calculator` retorna pelo menos um agente quando houver provedor de math.

4. **Provedores**
   - [ ] Usam o mesmo `SESSION_TOKEN_SECRET` do matching.
   - [ ] `DATAPLANE_PUBLIC_ENDPOINT` é acessível pelos consumidores (e se for TLS, certificados/CA corretos).

5. **Teste ponta a ponta**
   - [ ] Um provedor registrado e rodando (ex.: demo math expert).
   - [ ] Um consumidor com o mesmo NATS/registry.
   - [ ] Consumer envia pergunta; recebe match (sem timeout) e depois resposta do provedor.

---

## 7. Resumo dos segredos

| Quem | NATS_TOKEN | SESSION_TOKEN_SECRET |
|------|------------|----------------------|
| Matching (AWS) | Sim (igual aos clientes) | Sim (gera o token HMAC do match) |
| Consumer | Sim | Não precisa |
| Provider | Sim | Sim (valida o token; deve ser igual ao do matching) |

Se o consumer der **timeout** (ex.: "Request timeout after 25000ms"), em geral:
- o matching não está no mesmo NATS, ou
- o matching não está recebendo o request (NATS_URL/token errados), ou
- o matching não está publicando em `mesh.matches` (erro ao consultar registry ou ao publicar).

Logs do matching (e métricas, se houver) ajudam a ver se o request chegou e se o match foi publicado.

---

## 8. Funcionava antes e parou? (timeout)

O matching exige **`SESSION_TOKEN_SECRET`** na inicialização (Community: token HMAC; Enterprise: JWT). Se essa variável **não estiver definida** no ambiente do matching na AWS, o processo faz `log.Fatalf("SESSION_TOKEN_SECRET is required")` e **nem chega a conectar no NATS** — o matching não sobe.

Resultado: ninguém escuta `mesh.requests.>`, nenhum match é publicado, e o consumer fica em timeout.

**O que fazer:**

1. **Definir `SESSION_TOKEN_SECRET` no matching (AWS)**  
   Use o mesmo valor em todo lugar onde o matching roda (ex.: ECS task definition, Lambda env, ou Secrets Manager). Valor sugerido: string forte (ex.: `openssl rand -base64 32`).

2. **Repassar o mesmo valor para os provedores**  
   No `.env` do provider (ou no deployment do provider), configure o **mesmo** `SESSION_TOKEN_SECRET`. O matching gera o token do match com esse segredo; o provider valida com o mesmo segredo.

3. **Redeployar o matching**  
   Após configurar a variável, subir uma nova versão do matching e conferir nos logs que aparece "matching subscribed to mesh.requests.>".

Depois disso, o consumer deve voltar a receber o match (e o handshake no data plane deve aceitar o token).
