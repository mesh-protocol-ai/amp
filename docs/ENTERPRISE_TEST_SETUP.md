# Enterprise test environment — MVP

This document covers the decision **AWS vs Oracle**, use of **Terraform**, and the **ideal setup** for a test Enterprise instance: a NATS cluster + 4 test agents so developers can try the SDK against `meshprotocol.dev`.

---

## 1. AWS vs Oracle

| Criterion | AWS | Oracle (OCI) |
|-----------|-----|----------------|
| **Terraform** | Official provider, many examples | Official OCI provider, well documented |
| **Time to production** | Faster (more examples, more Stack Overflow) | Slightly slower if team is not used to OCI |
| **Cost (MVP)** | Low (e.g. t3.small ~$15/mo) | Often lower with generous free tier |
| **Ecosystem** | Larger (NATS, Go, Docker examples) | Good; same stack runs fine |
| **When to choose Oracle** | — | Company policy, existing OCI credits, or demo targeting Oracle ecosystem |

**Recommendation:** Prefer **AWS** to ship the test environment quickly, unless you have a strong reason to use Oracle (policy, credits, or “we’re an Oracle shop”). Both are viable; Terraform works for both.

---

## 2. Terraform

Yes — you can and should use **Terraform** for this MVP.

- **AWS:** `hashicorp/aws` provider (EC2, VPC, security groups, optional Route53, optional ACM).
- **Oracle:** `oracle/oci` provider (Compute, VCN, security lists, optional DNS).

The repo includes a minimal **AWS** layout under `deployments/terraform/aws/`. You can mirror it for OCI (same idea: one VM, security list, optional DNS).

---

## 3. Ideal MVP setup

### 3.1 Goal

- One **NATS** (JetStream) instance reachable at `nats.meshprotocol.dev:4222` (TLS).
- **Registry** API at `https://api.meshprotocol.dev` (or `https://registry.meshprotocol.dev`).
- **Matching** running next to Registry, not exposed publicly.
- **4 test agents** already registered and responding so devs can call the SDK and get matches.

### 3.2 Architecture (single VM for MVP)

```
                    meshprotocol.dev (DNS)
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
  api.meshprotocol.dev   nats.meshprotocol.dev   (optional: docs)
         │                    │
         │  :443 (HTTPS)      │  :4222 (TLS)
         ▼                    ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Single VM (e.g. AWS t3.small / Oracle VM.Standard.E2.1)  │
  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────────┐  │
  │  │ Caddy   │  │ Registry │  │ Matching │  │ Postgres   │  │
  │  │ (TLS)   │──│ (Go)     │  │ (Go)     │  │            │  │
  │  └─────────┘  └──────────┘  └────┬────┘  └───────────┘  │
  │       │              │             │             │        │
  │       │              └─────────────┴─────────────┘        │
  │       │                            │                       │
  │  ┌────▼────┐                       │                       │
  │  │  NATS   │◄──────────────────────┘                       │
  │  │ JetStream│                                               │
  │  └─────────┘                                               │
  │       ▲                                                    │
  │       │ 4 test agent processes (mock providers)             │
  │  ┌────┴────┐                                               │
  │  │ test-   │  (e.g. echo, calculator, translator, summary) │
  │  │ agents  │                                               │
  │  └─────────┘                                               │
  └──────────────────────────────────────────────────────────┘
```

- **One VM** runs: Caddy, Registry, Matching, Postgres, NATS, and a small “test agents” process (or 4 containers) that listen for matches and respond.
- **TLS:** Caddy with Let’s Encrypt for the API; NATS with TLS (or at least token auth for MVP).
- **4 test agents:** 4 Agent Cards registered in Registry + 4 mock providers that subscribe to `mesh.matches`, handle matches where they are the provider, and reply (e.g. echo, simple math, placeholder translator/summarizer).

### 3.3 What developers get

- **NATS_URL:** `nats://nats.meshprotocol.dev:4222` (or `nats://token@nats.meshprotocol.dev:4222` if you use token auth).
- **REGISTRY_URL:** `https://api.meshprotocol.dev`.
- **API key** (if you add auth to the Registry): one key per dev or a shared test key.
- **Pre-registered agents:** e.g. `demo.echo` (echo), `demo.math` (calculator), plus two more so devs can test `mesh.request()` and get matches without running providers themselves.

### 3.4 Steps to go live (high level)

1. **DNS:** Point `api.meshprotocol.dev` and `nats.meshprotocol.dev` to the VM’s public IP (or LB).
2. **Terraform:** Apply the AWS (or OCI) stack so the VM exists and ports 80, 443, 4222 are open.
3. **On the VM:** Clone the repo, use the same stack as `deployments/public/` (docker-compose + Caddy + NATS token + Postgres + Registry + Matching). Adapt Caddyfile and NATS config for `meshprotocol.dev`.
4. **Secrets:** Set `POSTGRES_PASSWORD`, `NATS_TOKEN`, and optionally Registry API key via `.env` or parameter store; do not commit them.
5. **4 test agents:** Run a one-off script (or a container) that registers 4 Agent Cards and starts 4 mock providers (or one multi-agent process). Reuse or extend the existing demo agents (e.g. from `examples/nebula-mesh-demo`).

---

## 4. Terraform layout (AWS)

Location: `deployments/terraform/aws/`.

- **main.tf:** EC2 instance, security group (22, 80, 443, 4222), optional Elastic IP.
- **variables.tf:** `region`, `instance_type`, `ssh_key_name`, `domain` (e.g. `meshprotocol.dev`).
- **outputs.tf:** Public IP and DNS names for Caddy/NATS.

After `terraform apply`, you SSH into the VM and run the Docker stack (see `deployments/public/` and the repo’s main README). Optionally, add a small `user_data` script that only installs Docker and Docker Compose so the VM is ready for a manual deploy.

---

## 5. Oracle (OCI) equivalent

Same idea:

- One **Compute** instance.
- **VCN** + **security list** allowing 22, 80, 443, 4222.
- **Optional:** Reserved public IP or Load Balancer.
- On the VM: same Docker Compose as in `deployments/public/`, adapted for `meshprotocol.dev`.

You can add a second Terraform module under `deployments/terraform/oci/` with the same logical layout (one VM, open ports, outputs).

---

## 6. Summary

- **Cloud:** Prefer **AWS** for this MVP unless you need Oracle.
- **Terraform:** Use it for both AWS and Oracle; the repo includes an AWS skeleton.
- **MVP:** One VM, NATS + Registry + Matching + Postgres + Caddy; TLS for API and NATS; 4 pre-registered test agents so devs can test the SDK against `meshprotocol.dev` without running their own stack.
