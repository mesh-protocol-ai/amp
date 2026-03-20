# Control Plane Security & NATS Hardening (Phase 6)

Objetivo: resumir as práticas recomendadas para colocar o plano de controle (NATS + JetStream) em produção com segurança, e fornecer exemplos de configuração e ACLs para adoção rápida.

## Resumo rápido
- Exigir TLS mútua sempre que possível (client <-> server e server <-> server).
- Usar NKeys / JWT (operator/account model via `nsc`) para autenticação de serviços e agentes.
- Aplicar autorização mínima (principle of least privilege) via `permissions` por usuário/conta.
- Habilitar JetStream com políticas de retenção e replicação adequadas; auditar e fazer backup do metadata.

## TLS / Transporte
- Gere certificados organizacionais (CA interna) ou use um provedor confiável; proteja chaves privadas.
- Exemplo (trecho `nats.conf`):

```conf
tls {
  cert_file: "/etc/nats/certs/server-cert.pem"
  key_file: "/etc/nats/certs/server-key.pem"
  ca_file: "/etc/nats/certs/ca.pem"
  timeout: 2
}
```

- Recomendação: habilite verificação de hostname/chain nos clientes e rotacione certificados regularmente.

## Autenticação: NKeys / JWT / Credentials
- Para produção recomendamos o fluxo operator → account → user via `nsc` (NATS Server Operator CLI). Isso permite revogação e rotação com JWTs.
- Fluxo curto (exemplo):
  1. `nsc` init operator
  2. `nsc add account mesh`
  3. `nsc add user mesh --name matching-service`
  4. `nsc generate creds --account mesh --user matching-service` → gera `.creds`
- Conexão no Go usando arquivo de credenciais:

```go
nc, _ := nats.Connect(natsURL, nats.UserCredentials("/etc/nats/creds/matching.creds"))
```

## Autorização / ACLs (exemplos)
- Princípio: cada agente/service só pode publicar/assinar os subjects necessários.
- Exemplo simples (config `authorization` com users):

```conf
authorization {
  users = [
    { user: "matching", password: "<hash>", permissions = { publish = ["mesh.audit.>", "mesh.matches.>"] , subscribe = ["mesh.requests.>"] } },
    { user: "agent-1", password: "<hash>", permissions = { publish = ["mesh.requests.agent-1"], subscribe = ["mesh.matches.agent-1"] } }
  ]
}
```

- Exemplo (operator/account model): criar accounts with scoped permissions; quando usar `nsc` prefira emitir users com `permissions` limitadas.
- SDK / agents: ao registrar `did`, valide e restringa o `subscribe` token para `mesh.matches.<sanitized-did>`.

## JetStream: políticas e recomendações
- Crie um stream dedicado para auditoria: subject `mesh.audit.>`.
- CLI exemplo para criar stream:

```bash
nats stream add MESH_AUDIT --subjects 'mesh.audit.>' --storage file --replicas 3 --retention limits --max-age 168h
```

- Configure retenção/replication conforme RPO/RTO desejado; habilite backing up dos arquivos `jetstream` metadata.

## Operação e deploy
- Não exponha a porta management sem TLS e firewall; use network policies (k8s) ou security groups.
- Monitore: conexões, auth failures, JetStream consumer lag, stream depth.
- Automatize rotação de credenciais (short-lived JWTs) e procedimentos de revogação.

## Checklist para validação (runbook)
- [ ] TLS válido e forçado em todas conexões.
- [ ] `matching` service usa `UserCredentials` / NKey e não `NATS_TOKEN` em produção.
- [ ] Cada agent tem permissões `publish`/`subscribe` limitadas ao seu DID.
- [ ] JetStream `MESH_AUDIT` existe e tem retenção/replicas adequadas.
- [ ] Backups automatizados do JetStream metadata e configuração de disaster recovery.
- [ ] Monitoramento e alertas configurados (auth failures, consumer lag, stream errors).

## Comandos úteis
- Criar stream:
  `nats --server <url> stream add MESH_AUDIT --subjects 'mesh.audit.>' --storage file --replicas 3`
- Gerar credenciais (nsc) e distribuir para serviços com segredos montados em arquivos `.creds`.

## Notas finais
- Este documento fornece exemplos e um checklist para fechar a Fase 6. Ajuste políticas e paths de arquivos ao seu ambiente (k8s, systemd, Docker Swarm).
