

# Agent Mesh Protocol (AMP)

## Complete Specification Documentation

**Version:** 0.1.0-draft
**Date:** January 2025
**Status:** RFC (Request for Comments)
**Authors:** [TBA]
**License:** Apache-2.0

---

## Summary

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Architecture](#3-architecture)
4. [Identity and Authentication](#4-identity-and-authentication)
5. [Agent Card Specification](#5-agent-card-specification)
6. [Context Contract Specification](#6-context-contract-specification)
7. [Message Protocol](#7-message-protocol)
8. [Matching Engine](#8-matching-engine)
9. [Data Plane — Secure Data Exchange](#9-data-plane--secure-data-exchange)
10. [Governance and Access Policies](#10-governance-and-access-policies)
11. [Economic System](#11-economic-system)
12. [Observability and Audit Trail](#12-observability-and-audit-trail)
13. [SDK Specification](#13-sdk-specification)
14. [Deployment and Operation](#14-deployment-and-operation)
15. [Security — Threat Model](#15-security--threat-model)
16. [Implementation Roadmap](#16-implementation-roadmap)
17. [Glossary](#17-glossary)
18. [Appendices](#18-appendices)

---

## 1. Overview

### 1.1 What is the Agent Mesh Protocol

The **Agent Mesh Protocol (AMP)** is an open specification for creating a decentralized global network of AI agents, where agents publish capabilities, receive requests via event broker, compete for tasks and deliver results with security, governance and traceability.

### 1.2 Problem

```
Current state of AI agent integration:

┌─────────────────────────────────────────────────────┐
│                                                     │
│ • Each company rebuilds agents across domains │
│ outside your core (legal, financial, NLP) │
│                                                     │
│ • There is no standardized mechanism for an agent │
│ discover and consume capabilities of another agent │
│                                                     │
│ • Sensitive data prevents integration between │
│ organizations due to lack of formal guarantees │
│                                                     │
│ • Specialized knowledge is fragmented │
│ and duplicated across organizational silos │
│                                                     │
│ • No economic incentives for specialists │
│ publish their capabilities as a service │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 1.3 Solution

```
AMP creates an “Uber of AI agents”:

1. PROVIDERS agents publish their capabilities on the network
2. CONSUMERS agents publish capability REQUESTS
3. A global EVENT BROKER routes requests to compatible providers
4. Providers evaluate and make BID (offer)
5. MATCHING ENGINE selects the best provider
6. Data is exchanged DIRECTLY (P2P) with E2E encryption
7. Result is delivered, payment settled, reputation updated

The broker NEVER sees sensitive data.
It orchestrates — not transports.
```

### 1.4 Analogies

| System | Parallel with AMP |
|---------|-------------------|
| Uber | Passenger posts race → drivers bid → best match wins |
| Stock Exchange | Order published → market makers compete → best bid wins |
| Kubernetes Scheduler | Pod needs to run → scheduler finds best node |
| npm/PyPI | Package registry → AMP is registry of living capabilities |
| DNS + Anycast | Resolution goes to the most suitable server |

### 1.5 Ecosystem Participants

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   CONSUMER   │     │    MESH      │     │   PROVIDER   │
│              │     │   BROKER     │     │              │
│ Who needs it │────►│ │◄────│ Who offers │
│ of capability│ │ Orchestra │ │ capability │
│              │◄────│ matches      │────►│              │
│ Ex: Fintech  │     │              │     │ Ex: LegalTech│
│ who needs │ │ NEVER sees │ │ who offers │
│ analysis │ │ data │ │ analysis │
│ legal │ │ business │ │ contracts │
└──────────────┘     └──────────────┘     └──────────────┘

The same agent can be CONSUMER and PROVIDER simultaneously.
```

---

## 2. Design Principles

### 2.1 Fundamental Principles

```
P1: BLIND BROKER
The broker orchestrates, never sees business data.
Control plane and data plane are strictly separated.

P2: DECLARATIVE SPECIALIST
Agents formally declare what they need (Context Contract)
and what they produce (Output Schema), eliminating ambiguity.

P3: NATIVE GOVERNANCE
Access control, compliance and auditing are part
of the protocol, not optional add-ons.

P4: COMPETITION FOR QUALITY
Multiple providers compete for each request.
Trust scores, cost and performance determine the winner.

P5: LAYERED SECURITY
Defense in depth: plane separation, E2E encryption,
mTLS, TEE, DIDs, cryptographic audit trail.

P6: FRAMEWORK AGNOSTIC
Any framework (LangGraph, CrewAI, AutoGen, custom)
can participate. The protocol is the interface, not the implementation.

P7: PROGRESSIVE DISCLOSURE
Complexity is opt-in. A simple agent needs
few lines. Advanced features (TEE, governance tiers)
are added incrementally.
```

### 2.2 Architectural Decisions (ADRs)

| ID | Decision | Rational |
|----|---------|----------|
| ADR-001 | NATS JetStream for control plane | Sub-ms latency, native request/reply, super clusters for global federation, leaf nodes for edge |
| ADR-002 | gRPC + QUIC for data plane | Performance, bidirectional streaming, typed schemas (protobuf), native HTTP/3 |
| ADR-003 | CloudEvents as envelope | Open, extensible, interoperable CNCF standard |
| ADR-004 | DIDs (W3C) for Identity | Decentralized, no central authority, verifiable |
| ADR-005 | OPA/Rego for policies | Industry standard, declarative, auditable, versionable |
| ADR-006 | Control/data plane separation | Broker-blind principle, sensitive data never passes through the broker |
| ADR-007 | Context Contract as formal spec | Eliminates ambiguity in dependencies, allows automatic resolution |
| ADR-008 | Ephemeral ECDH for session keys | Forward secrecy, keys discarded after session |

---

## 3. Architecture

### 3.1 Architectural Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     AGENT MESH PROTOCOL                        │
│                                                                │
│  ┌──────────────────── CONTROL PLANE ────────────────────────┐ │
│  │                                                           │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │ │
│  │  │ NATS Super  │  │   MATCHING   │  │   TRUST &       │  │ │
│  │  │ Cluster     │  │   ENGINE     │  │   REPUTATION    │  │ │
│  │  │             │  │              │  │                 │  │ │
│  │  │ • Pub/Sub   │  │ • Scoring    │  │ • Agent scores  │  │ │
│  │  │ • Req/Reply │  │ • Filtering  │  │ • Task history  │  │ │
│  │  │ • Queue Grp │  │ • Ranking    │  │ • Disputes      │  │ │
│  │  │ • JetStream │  │ • Selection  │  │ • Certifications│  │ │
│  │  └─────────────┘  └──────────────┘  └─────────────────┘  │ │
│  │                                                           │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │ │
│  │  │  REGISTRY   │  │  GOVERNANCE  │  │   SETTLEMENT    │  │ │
│  │  │             │  │  ENGINE      │  │                 │  │ │
│  │  │ • Agent Cards│  │ • OPA/Rego  │  │ • Escrow        │  │ │
│  │  │ • Contracts │  │ • Tier eval  │  │ • Billing       │  │ │
│  │  │ • Schemas   │  │ • Consent    │  │ • SLA enforce   │  │ │
│  │  │ • Versions  │  │ • Audit      │  │ • Disputes      │  │ │
│  │  └─────────────┘  └──────────────┘  └─────────────────┘  │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────── DATA PLANE ───────────────────────────┐ │
│  │                                                           │ │
│  │  Consumer ◄══════ gRPC mTLS + E2E Encryption ══════► Provider │
│  │                   (peer-to-peer, broker excluded)         │ │
│  │                                                           │ │
│  │  • ECDH ephemeral key exchange                            │ │
│  │  • AES-256-GCM payload encryption                         │ │
│  │  • Optional TEE (Nitro/SGX/SEV)                           │ │
│  │  • Streaming support for large payloads                   │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────── AGENT SDK ────────────────────────────┐ │
│  │                                                           │ │
│  │  mesh.register()  mesh.request()  mesh.listen()           │ │
│  │  mesh.bid()       mesh.deliver()  mesh.rate()             │ │
│  │                                                           │ │
│  │  Languages: Python, TypeScript, Go, Rust                  │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 Global Network Topology

```
                    ┌──────────────┐
│  NATS Super  │
│  Cluster     │
│  (Control)   │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼──────┐  ┌─────▼───────┐  ┌─────▼───────┐
│ NATS Region │  │ NATS Region │  │ NATS Region │
│ Sao Paulo │ │ Virginia │ │ Frankfurt │
   │             │  │             │  │             │
│ Gateway     │  │ Gateway     │  │ Gateway     │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
    ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
│  Agents   │    │  Agents   │    │  Agents   │
│  LATAM    │    │  US-East  │    │  Europe   │
    │           │    │           │    │           │
    │ ┌───────┐ │    │ ┌───────┐ │    │ ┌───────┐ │
│ │Agent 1│ │    │ │Agent 4│ │    │ │Agent 7│ │
│ │Agent 2│ │    │ │Agent 5│ │    │ │Agent 8│ │
│ │Agent 3│ │    │ │Agent 6│ │    │ │Agent 9│ │
    │ └───────┘ │    │ └───────┘ │    │ └───────┘ │
    └───────────┘    └───────────┘    └───────────┘

Edge/On-prem agents connect via NATS Leaf Nodes.
Data plane is always P2P between consumer and provider.
```

### 3.3 System Components

| Component | Responsibility | Base Technology |
|------------|------------------|-----------------|
| **Event Router** | Pub/sub of requests and bids in the control plane | NATS JetStream |
| **Registry** | Stores Agent Cards, Context Contracts, schemas | PostgreSQL + NATS KV |
| **Matching Engine** | Filter, score and select the best provider | Custom (Rust/Go) |
| **Trust Engine** | Maintains reputation scores, history, certifications | PostgreSQL + Redis |
| **Governance Engine** | Evaluates access, compliance, masking policies | Open Policy Agent |
| **Settlement Service** | Escrow, billing, SLA enforcement, disputes | Custom + payment provider |
| **Audit Service** | Append-only log, Merkle tree, anchoring | PostgreSQL + custom |
| **Gateway** | Inbound proxy for agents, TLS termination | Envoy/custom |
| **SDK** | Client-side abstraction for devs | Python, TypeScript, Go |

---

## 4. Identity and Authentication

### 4.1 Decentralized Identifiers (DIDs)

Each network participant has a DID according to the W3C specification.

```
Format:
did:mesh:<entity-type>:<unique-id>

Examples:
did:mesh:agent:credit-analyzer-br-001
did:mesh:org:fintech-xyz
did:mesh:broker:us-east-1
```

### 4.2 DID Document

```json
{
"@context": [
"https://www.w3.org/ns/did/v1",
"https://amp.protocol/ns/v1"
  ],
"id": "did:mesh:agent:credit-analyzer-br-001",
  
"verificationMethod": [
    {
"id": "did:mesh:agent:credit-analyzer-br-001#key-1",
"type": "Ed25519VerificationKey2020",
"controller": "did:mesh:org:legaltech-abc",
"publicKeyMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
    }
  ],
  
"authentication": [
"did:mesh:agent:credit-analyzer-br-001#key-1"
  ],
  
"keyAgreement": [
    {
"id": "did:mesh:agent:credit-analyzer-br-001#key-agreement-1",
"type": "X25519KeyAgreementKey2020",
"publicKeyMultibase": "z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc"
    }
  ],
  
"service": [
    {
"id": "did:mesh:agent:credit-analyzer-br-001#mesh-endpoint",
"type": "AgentMeshEndpoint",
"serviceEndpoint": "grpc://credit-agent.legaltech-abc.mesh:443"
    },
    {
"id": "did:mesh:agent:credit-analyzer-br-001#attestation",
"type": "TEEAttestationEndpoint",
"serviceEndpoint": "https://credit-agent.legaltech-abc.mesh/attest"
    }
  ]
}
```

### 4.3 Authentication Flow

```
1. NETWORK REGISTRATION
Agent generates Ed25519 key pair → creates DID Document
→ publishes to Registry → receives confirmation

2. BROKER AUTHENTICATION (Control Plane)
Agent connects to NATS → presents NKey (derived from DID)
→ NATS validates → authenticated connection
→ All messages signed with Ed25519

3. P2P AUTHENTICATION (Data Plane)
After match, consumer and provider:
→ Resolve each other's DID Documents
→ Establish mTLS with certificates derived from DID
→ ECDH key agreement for session key
→ Secure E2E channel established

4. THIRD PARTY VERIFICATION
Any participant can verify another's identity:
→ Resolve DID → obtain public key → verify signatures
→ Does not depend on the broker for trust
```

### 4.4 Trust Model

```
┌─────────────────────────────────────────────────────┐
│                TRUST HIERARCHY                       │
│                                                     │
│  Layer 1: IDENTITY (DID)                            │
│ "I am who I say I am" │
│ → Cryptographically verifiable │
│                                                     │
│  Layer 2: REPUTATION (Trust Score)                   │
│ "I have a history of good behavior" │
│ → Based on ratings, success rate, volume │
│                                                     │
│  Layer 3: CERTIFICATION                              │
│ "A recognized authority certified me" │
│    → SOC2, ISO 27001, OAB, CRM, CVM                │
│    → Verifiable Credentials (W3C)                   │
│                                                     │
│  Layer 4: ATTESTATION (TEE)                          │
│ "My hardware proves that I run healthy code" │
│    → Intel SGX, AMD SEV, AWS Nitro attestation       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 5. Agent Card Specification

The Agent Card is the public document that describes an agent on the network. It is indexable, searchable and versioned.

### 5.1 Complete Diagram

```yaml
# Agent Card Specification v1.0

apiVersion: amp/v1
kind: AgentCard
metadata:
id: "did:mesh:agent:credit-analyzer-br-001"
name: "CreditRiskAnalyzer"
version: "3.2.1"
created: "2024-06-15T00:00:00Z"
updated: "2025-01-10T00:00:00Z"
owner: "did:mesh:org:legaltech-abc"
  
labels:
environment: "production"
tier: "premium"
    
annotations:
description: "Credit risk analysis for Brazilian companies with proprietary model trained on 500K+ real decisions"
long_description: |
Agent specialized in credit risk assessment
for legal entities in the Brazilian market.
Uses proprietary scoring model combined with
BACEN rules and automated sector analysis.
homepage: "https://legaltech-abc.com/credit-agent"
documentation: "https://docs.legaltech-abc.com/credit-agent"
support: "support@legaltech-abc.com"

spec:
# Domains of activity (hierarchical, used in matching)
domains:
primary: ["finance", "credit-analysis"]
secondary: ["risk-management", "banking"]
tags: ["brazil", "pj", "bacen", "scoring"]
  
# Capabilities offered
capabilities:
- id: "credit-risk-assessment"
description: "Complete corporate credit risk assessment"
languages: ["pt-BR", "en"]
      
- id: "credit-scoring"
description: "Numerical credit score with breakdown"
languages: ["pt-BR", "en"]
      
- id: "portfolio-risk"
description: "Credit portfolio risk analysis"
languages: ["pt-BR"]
  
# Operational limits
operational:
max_concurrent_tasks: 100
avg_latency_ms: 8000
p99_latency_ms: 15000
max_input_size_mb: 10
availability_sla: 0.999
    
regions:
deployed: ["br-southeast-1", "br-south-1"]
data_residency: ["BR"]
    
schedule:
      type: "always_on"  # ou "business_hours", "on_demand"
timezone: "America/Sao_Paulo"
  
# Security
security:
encryption:
transport: "TLS-1.3"
payload: ["AES-256-GCM", "ChaCha20-Poly1305"]
key_exchange: "ECDH-P384"
    
tee:
available: true
      type: "AWS_NITRO_ENCLAVE"
attestation_endpoint: "https://credit-agent.legaltech-abc.mesh/attest"
    
compliance:
certifications: ["SOC2-TypeII", "ISO-27001"]
regulatory: ["LGPD", "BACEN-4893"]
audit_frequency: "quarterly"
    
data_handling:
retention: "ephemeral" # data deleted after execution
logging: "metadata_only" # never log business data
purpose_limitation: ["credit-assessment", "risk-analysis"]
  
# Economic model
pricing:
model: "per_request"
currency: "USD"
tiers:
basic:
cost: 0.10
rate_limit: "100/day"
pro:
cost: 0.35
rate_limit: "1000/day"
enterprise:
cost: 0.80
rate_limit: "unlimited"
sla_penalty: true
  
# Reference to Context Contract (separate complete spec)
context_contract:
ref: "https://registry.mesh/contracts/credit-analyzer-br-001/v3.2.1"
hash: "sha256:a1b2c3d4e5f6..."
  
# Endpoints
endpoints:
control_plane:
nats_subject: "mesh.agents.finance.credit-analysis.br"
data_plane:
grpc: "grpc://credit-agent.legaltech-abc.mesh:443"
websocket: "wss://credit-agent.legaltech-abc.mesh/ws"

status:
health: "healthy"
last_heartbeat: "2025-01-15T10:30:00Z"
trust_score: 4.8
total_tasks: 15230
success_rate: 0.97
avg_rating: 4.7
active_since: "2024-06-15"
```

### 5.2 Agent Card Life Cycle

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌───────────┐
│  DRAFT   │────►│ PENDING  │────►│  ACTIVE  │────►│ DEPRECATED│
│          │     │ REVIEW   │     │          │     │           │
└─────────┘     └──────────┘     └──────────┘     └───────────┘
                      │               │  ▲               │
                      │               │  │               │
                      ▼               ▼  │               ▼
                ┌──────────┐     ┌──────────┐     ┌───────────┐
│ REJECTED │     │SUSPENDED │     │  RETIRED  │
                └──────────┘     └──────────┘     └───────────┘

States:
DRAFT: Card created, not published
PENDING: Submitted for validation (schema check, basic security)
ACTIVE:      Accepting requests
SUSPENDED: Temporarily unavailable (maintenance, SLA violation)
DEPRECATED: Marked for removal, accepts requests but warns callers
RETIRED: Removed from the network, does not accept requests
REJECTED: Initial validation failed
```

---

## 6. Context Contract Specification

### 6.1 Purpose

The Context Contract formally defines:
- What the agent **needs to receive** from the caller (caller_provided)
- What the agent **looks for alone** on the network (external_dependencies)
- What the agent **already knows** (embedded_knowledge)
- **Validation rules** for inputs
- **Fallback behavior** when context fails

### 6.2 Complete Diagram

```yaml
apiVersion: amp/v1
kind: ContextContract
metadata:
id: "contract:credit-analyzer-br-001:v3.2.1"
agent_ref: "did:mesh:agent:credit-analyzer-br-001"
version: "3.2.1"
hash: "sha256:a1b2c3d4e5f6..."
  
spec:
  # ═══════════════════════════════════════════
# SECTION 1: Context provided by CALLER
  # ═══════════════════════════════════════════
caller_provided:
- key: "company_financials"
description: "Company financial statements"
required: true
classification: "confidential"
schema:
        type: "object"
ref: "https://schemas.mesh.finance/FinancialStatement/v2"
properties:
company_cnpj:
            type: "string"
pattern: "^\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}$"
company_name:
            type: "string"
sector:
            type: "string"
            enum: ["varejo", "industria", "servicos", "agro", "tech", "saude", "construcao", "outros"]
revenue_12m:
            type: "number"
minimum: 0
ebitda_12m:
            type: "number"
debt_total:
            type: "number"
minimum: 0
cash_and_equivalents:
            type: "number"
minimum: 0
payment_history:
            type: "array"
items:
              type: "object"
properties:
date: { type: "string", format: "date" }
amount: { type: "number" }
days_late: { type: "integer", minimum: 0 }
minItems: 3
description: "Minimum 3 months of history"
      
validation_rules:
- rule: "debt_total <= revenue_12m * 5"
severity: "warning"
          message: "Debt > 5x annual revenue — check data"
- rule: "payment_history.length >= 3"
severity: "error"
          message: "Minimum 3 payment records required"
    
- key: "risk_appetite"
description: "Applicant risk policy"
required: true
classification: "internal"
schema:
        type: "object"
properties:
max_exposure:
            type: "number"
minimum: 0
description: "Maximum desired exposure in BRL"
preferred_risk_level:
            type: "string"
            enum: ["conservative", "moderate", "aggressive"]
industry_restrictions:
            type: "array"
items: { type: "string" }
description: "Sectors vetoed by internal policy"
    
- key: "previous_decisions"
description: "Decision history for this customer"
required: false
classification: "confidential"
schema:
        type: "array"
items:
          type: "object"
properties:
date: { type: "string", format: "date" }
decision: { type: "string", enum: ["approved", "denied", "review"] }
amount: { type: "number" }
notes: { type: "string" }
enrichment_effect: "Improves result confidence by ~15%"
    
- key: "consent_proofs"
description: "Evidence of consent to consult bureaus"
required: true
classification: "compliance"
schema:
        type: "object"
properties:
credit_bureau:
            type: "string"
format: "jwt"
description: "JWT signed by the holder authorizing consultation"
data_processing:
            type: "string"
format: "jwt"
description: "LGPD consent for processing"

  # ═══════════════════════════════════════════
# SECTION 2: Auto-resolved context
  # ═══════════════════════════════════════════
external_dependencies:
- key: "selic_rate"
description: "Current Selic rate and COPOM projection"
source:
domain: ["finance", "macro-rates"]
query: "Current Selic rate and projection for the next quarter"
freshness:
max_age: "1h"
stale_while_revalidate: "24h"
cache_scope: "global"
fallback:
strategy: "use_default"
default_value: { "current": 0.1375, "projection": "stable" }
required: true
      
- key: "sector_analysis"
description: "Sectoral analysis for the company's segment"
source:
domain: ["market", "sector-analysis"]
query: "dynamic:Analysis of the {input.company_financials.sector} sector in Brazil, prospects and risks"
freshness:
max_age: "24h"
cache_scope: "per_sector"
fallback:
strategy: "degrade_gracefully"
impact: "Reduces confidence by ~10%"
required: false
      
- key: "credit_bureau_score"
description: "Credit bureau score and history"
source:
domain: ["data", "credit-bureau"]
query: "dynamic:Score and restrictions for CNPJ {input.company_financials.company_cnpj}"
freshness:
max_age: "7d"
cache_scope: "per_entity"
requires_consent: true
consent_ref: "input.consent_proofs.credit_bureau"
data_residency: ["BR"]
fallback:
strategy: "skip_with_warning"
impact: "Reduces confidence by ~20%, score based only on provided data"
required: false
      
- key: "economic_indicators"
description: "Relevant macroeconomic indicators"
source:
domain: ["finance", "economic-indicators"]
query: "IPCA, GDP, exchange rate, unemployment — last 12 months and projection"
freshness:
max_age: "6h"
cache_scope: "global"
fallback:
strategy: "use_stale"
max_stale: "7d"
required: false

  # ═══════════════════════════════════════════
# SECTION 3: Embedded knowledge
  # ═══════════════════════════════════════════
embedded_knowledge:
- type: "ml_model"
name: "Scoring Model v3.2"
description: "Scoring model trained with 500K+ real decisions from the Brazilian market"
last_updated: "2025-01-01"
metrics:
auc_roc: 0.89
ks_statistic: 0.62
gini: 0.78
        
- type: "rule_engine"
name: "BACEN rules"
description: "Resolution 4,893/2021 and related circulars"
last_updated: "2025-01-10"
source: "Banco Central do Brasil"
      
- type: "knowledge_base"
name: "Sector Benchmarks"
description: "Averages of financial indicators by sector (DRE, balance sheet)"
last_updated: "2024-Q4"
coverage: "12 main sectors of the Brazilian economy"

  # ═══════════════════════════════════════════
# SECTION 4: Output specification per tier
  # ═══════════════════════════════════════════
output:
base_schema:
      type: "object"
properties:
risk_score:
          type: "integer"
minimum: 0
maximum: 100
description: "Risk score (0=no risk, 100=maximum risk)"
risk_level:
          type: "string"
          enum: ["very_low", "low", "moderate", "high", "very_high"]
max_recommended_exposure:
          type: "number"
description: "Maximum recommended exposure in BRL"
key_risks:
          type: "array"
items: { type: "string" }
description: "Main risk factors identified"
mitigating_factors:
          type: "array"
items: { type: "string" }
description: "Factors that reduce risk"
justification:
          type: "string"
description: "Narrative explaining the analysis"
confidence:
          type: "number"
minimum: 0
maximum: 1
description: "Degree of confidence in the analysis"
signal_breakdown:
          type: "object"
description: "Decomposition of the signals that make up the score"
properties:
financial_health: { type: "number" }
payment_behavior: { type: "number" }
sector_risk: { type: "number" }
macro_environment: { type: "number" }
bureau_signals: { type: "number" }
confidence_intervals:
          type: "object"
properties:
risk_score_ci_90: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }
model_metadata:
          type: "object"
properties:
model_version: { type: "string" }
features_used: { type: "array", items: { type: "string" } }
decision_path: { type: "array", items: { type: "string" } }
data_sources_used:
          type: "array"
items: { type: "string" }
description: "List of actually used data sources"
    
tier_projections:
basic:
fields: ["risk_score", "risk_level", "data_sources_used"]
pro:
fields: ["risk_score", "risk_level", "max_recommended_exposure", "key_risks", "mitigating_factors", "justification", "confidence", "data_sources_used"]
enterprise:
fields: ["*"] # All fields
regulator:
fields: ["*"]
additional: ["full_audit_trail", "model_explainability"]

  # ═══════════════════════════════════════════
# SECTION 5: Fallback behavior
  # ═══════════════════════════════════════════
fallback_behavior:
on_caller_missing_required:
action: "reject"
error_code: "CONTEXT_MISSING_REQUIRED"
      
on_caller_validation_warning:
action: "proceed_with_warning"
include_warnings_in_output: true
      
on_caller_validation_error:
action: "reject"
error_code: "CONTEXT_VALIDATION_FAILED"
      
on_external_dependency_failure:
action: "degrade_gracefully"
reduce_confidence: true
include_degradation_notice: true
      
on_all_external_deps_fail:
action: "execute_with_embedded_only"
min_confidence_threshold: 0.4
warn_caller: true
      
on_consent_missing:
action: "skip_dependent_source"
affected_keys: ["credit_bureau_score"]
```

### 6.3 Context Resolution — Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                  CONTEXT RESOLUTION ENGINE                       │
│                                                                  │
│  Input: Caller's request + Provider's Context Contract             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ STEP 1: VALIDATE CALLER INPUT                           │    │
│  │                                                          │    │
│ │ For each item in caller_provided: │ │
│  │   if required && missing → REJECT                        │    │
│  │   if present → validate against schema                   │    │
│  │     if validation_error → REJECT                         │    │
│  │     if validation_warning → WARN + CONTINUE              │    │
│  │   if not required && missing → CONTINUE (note absence)   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ STEP 2: CHECK CONSENT                                    │    │
│  │                                                          │    │
│ │ For each external_dependency with requires_consent: │ │
│ │ Verify JWT em consent_ref │ │
│  │   if valid → PROCEED                                     │    │
│  │   if invalid/missing → apply fallback (skip_with_warning)│    │
│  └──────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ STEP 3: RESOLVE EXTERNAL DEPENDENCIES                    │    │
│  │                                                          │    │
│ │ For each external_dependency (IN PARALLEL): │ │
│  │                                                          │    │
│  │   3a. Check cache:                                       │    │
│  │       if cached && fresh → USE CACHE                     │    │
│  │       if cached && stale && stale_while_revalidate       │    │
│  │         → USE STALE + trigger async refresh              │    │
│  │                                                          │    │
│  │   3b. If not cached:                                     │    │
│  │       → mesh.request(source.domain, source.query)        │    │
│  │       → if success → CACHE + USE                         │    │
│  │       → if timeout/error → apply fallback strategy       │    │
│  │         → use_default / degrade_gracefully / skip        │    │
│  │                                                          │    │
│  │   3c. Substituir "dynamic:" placeholders:                │    │
│  │       query: "dynamic:CNPJ {input.company_financials     │    │
│ │ .company_cnpj}" │ │
│ │ → resolves to real value of input │ │
│  └──────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ STEP 4: ASSEMBLE CONTEXT PACKAGE                         │    │
│  │                                                          │    │
│  │ context_package = {                                      │    │
│  │   caller: { validated caller inputs },                   │    │
│  │   external: { resolved dependencies },                   │    │
│  │   metadata: {                                            │    │
│  │     resolution_time_ms: 1200,                            │    │
│  │     cached_keys: ["selic_rate"],                          │    │
│  │     fresh_keys: ["credit_bureau_score"],                  │    │
│  │     failed_keys: [],                                     │    │
│  │     warnings: ["debt_total > 5x revenue"],               │    │
│  │     degradations: [],                                    │    │
│  │     consent_verified: ["credit_bureau"]                  │    │
│  │   }                                                      │    │
│  │ }                                                        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│                     DELIVER TO PROVIDER                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Messaging Protocol

### 7.1 Formato Base: CloudEvents

All messages in the control plane follow the CloudEvents v1.0 specification with AMP extensions.

### 7.2 AMP Extensions for CloudEvents

```json
{
"specversion": "1.0",
"type": "amp.<message_type>",
"source": "did:mesh:<entity>",
"id": "<uuid-v7>",
"time": "<RFC3339>",
"datacontenttype": "application/json",
  
"ampversion": "0.1.0",
"correlationid": "<uuid-v7>",
"sessionid": "<uuid-v7>",
"traceid": "<W3C trace id>",
"signature": "<ed25519 signature of data>",
  
"data": { ... }
}
```

### 7.3 Message Types

```
LIFECYCLE MESSAGES (registration and maintenance):
amp.agent.register Agent registers on the network
amp.agent.update Agent updates its card
amp.agent.heartbeat Agent reports health
amp.agent.deregister Agent leaves the network

REQUEST/BID CYCLE (core of the protocol):
amp.capability.request      Consumer publishes request
amp.capability.bid Provider makes offer
amp.capability.match        Broker confirma match
amp.capability.reject Broker rejects (no valid bids)
amp.capability.cancel       Consumer cancels request

EXECUTION (during processing):
amp.task.accepted           Provider accepts the task
amp.task.progress           Provider reports progress
amp.task.completed Provider delivers result
amp.task.failed Provider reports failure
amp.task.timeout            Task exceeded deadline

SETTLEMENT (post-execution):
amp.settlement.charge Charge generated
amp.settlement.confirmed Payment confirmed
amp.settlement.disputed Open dispute
amp.settlement.resolved Dispute resolved

TRUST (reputation):
amp.trust.rating Post-task rating
amp.trust.updated Score updated
amp.trust.alert Anomalous behavior alert
```

### 7.4 Detailed Messages

#### 7.4.1 Capability Request

```json
{
"specversion": "1.0",
"type": "amp.capability.request",
"source": "did:mesh:agent:fintech-xyz-orchestrator",
"id": "01JAXYZ123-request-uuid",
"time": "2025-01-15T10:30:00.000Z",
"datacontenttype": "application/json",
"ampversion": "0.1.0",
"correlationid": "01JAXYZ123-flow-uuid",
"traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
"signature": "ed25519:base64...",

"data": {
"task": {
"description": "Credit risk analysis for a corporate company",
"capability_id": "credit-risk-assessment",
"domain": ["finance", "credit-analysis"],
"language": "pt-BR",
"priority": "normal",
      
"input_manifest": {
"caller_provided_keys": [
"company_financials",
"risk_appetite",
"previous_decisions",
"consent_proofs"
        ],
"input_size_bytes": 45200,
"classification": "confidential"
      }
    },
    
"constraints": {
"max_latency_ms": 30000,
"max_cost_usd": 0.50,
"min_trust_score": 4.0,
"data_residency": ["BR"],
"compliance": ["LGPD"],
"security_level": "STANDARD",
"required_certifications": []
    },
    
"bid_config": {
"window_ms": 3000,
"max_bids": 10,
"selection_strategy": "BEST_SCORE",
"auto_select": true
    },
    
"data_exchange": {
"preferred_method": "GRPC_PUSH",
"consumer_endpoint": "grpc://fintech-xyz.mesh:443",
"supported_methods": ["GRPC_PUSH", "GRPC_PULL", "PRESIGNED_URL"],
"auth_method": "MTLS_EPHEMERAL",
"consumer_public_key": "base64..."
    }
  }
}
```

#### 7.4.2 Capability Bid

```json
{
"specversion": "1.0",
"type": "amp.capability.bid",
"source": "did:mesh:agent:credit-analyzer-br-001",
"id": "01JAXYZ456-bid-uuid",
"time": "2025-01-15T10:30:01.200Z",
"ampversion": "0.1.0",
"correlationid": "01JAXYZ123-request-uuid",
"signature": "ed25519:base64...",

"data": {
"offer": {
"cost_usd": 0.30,
"estimated_latency_ms": 8000,
"confidence_estimate": 0.87,
"tier_available": "pro"
    },
    
"agent_snapshot": {
"trust_score": 4.8,
"total_tasks_completed": 15230,
"success_rate": 0.97,
"avg_rating": 4.7,
"domain_experience": {
"finance.credit-analysis": {
"tasks": 12500,
"avg_rating": 4.8
        }
      },
"uptime_30d": 0.998
    },
    
"contract_hash": "sha256:a1b2c3d4e5f6...",
    
"context_resolution_plan": {
"will_resolve": ["selic_rate", "sector_analysis", "credit_bureau_score", "economic_indicators"],
"cached_available": ["selic_rate", "economic_indicators"],
"needs_fresh_fetch": ["credit_bureau_score"],
"estimated_resolution_ms": 2000
    },
    
"security": {
"tee_available": true,
"tee_type": "AWS_NITRO_ENCLAVE",
"encryption_supported": ["AES-256-GCM"],
"data_residency": "BR",
"provider_public_key": "base64...",
"did_document": "did:mesh:agent:credit-analyzer-br-001"
    },
    
"data_exchange": {
"preferred_method": "GRPC_PUSH",
"provider_endpoint": "grpc://credit-agent.legaltech-abc.mesh:443",
"supported_methods": ["GRPC_PUSH", "GRPC_PULL"]
    }
  }
}
```

#### 7.4.3 Match Confirmation

```json
{
"specversion": "1.0",
"type": "amp.capability.match",
"source": "did:mesh:broker:br-southeast-1",
"id": "01JAXYZ789-match-uuid",
"time": "2025-01-15T10:30:04.500Z",
"ampversion": "0.1.0",
"correlationid": "01JAXYZ123-request-uuid",
"signature": "ed25519:base64...",

"data": {
"request_id": "01JAXYZ123-request-uuid",
"winning_bid_id": "01JAXYZ456-bid-uuid",
    
"parties": {
"consumer": "did:mesh:agent:fintech-xyz-orchestrator",
"provider": "did:mesh:agent:credit-analyzer-br-001"
    },
    
"agreed_terms": {
"cost_usd": 0.30,
"max_latency_ms": 30000,
"tier": "pro",
"security_level": "STANDARD",
"contract_hash": "sha256:a1b2c3d4e5f6...",
"sla_penalty_enabled": false
    },
    
"session": {
"session_id": "01JAXYZ-session-uuid",
"created_at": "2025-01-15T10:30:04.500Z",
"expires_at": "2025-01-15T10:31:04.500Z",
"data_plane_auth": {
"token": "jwt:eyJ...",
"token_type": "Bearer",
"expires_in": 60
      }
    },
    
"escrow": {
"escrow_id": "01JAXYZ-escrow-uuid",
"amount_held_usd": 0.30,
"release_condition": "TASK_COMPLETED_AND_RATED",
"timeout_release": "REFUND_CONSUMER",
"dispute_window_seconds": 300
    },
    
"scoring_detail": {
"total_score": 0.92,
"breakdown": {
"cost_score": 0.85,
"latency_score": 0.90,
"trust_score": 0.96,
"capability_match": 0.95,
"compliance_match": 1.00
      },
"bids_received": 3,
"bids_filtered": 1
    }
  }
}
```

#### 7.4.4 Task Completed

```json
{
"specversion": "1.0",
"type": "amp.task.completed",
"source": "did:mesh:agent:credit-analyzer-br-001",
"id": "01JAXYZ-complete-uuid",
"time": "2025-01-15T10:30:12.800Z",
"ampversion": "0.1.0",
"correlationid": "01JAXYZ123-request-uuid",
"sessionid": "01JAXYZ-session-uuid",
"signature": "ed25519:base64...",

"data": {
"status": "completed",
"execution_time_ms": 8300,
    
"result_manifest": {
"output_hash": "sha256:d4e5f6...",
"output_size_bytes": 2400,
"tier_applied": "pro",
"fields_included": ["risk_score", "risk_level", "max_recommended_exposure", "key_risks", "mitigating_factors", "justification", "confidence", "data_sources_used"],
"fields_redacted": ["signal_breakdown", "confidence_intervals", "model_metadata"],
"delivered_via": "GRPC_PUSH"
    },
    
"context_resolution_report": {
"selic_rate": { "source": "cache", "age_seconds": 1800 },
"sector_analysis": { "source": "fresh_fetch", "latency_ms": 1200, "provider": "did:mesh:agent:market-analyzer-01" },
"credit_bureau_score": { "source": "fresh_fetch", "latency_ms": 800, "provider": "did:mesh:agent:serasa-bridge-01" },
"economic_indicators": { "source": "cache", "age_seconds": 3600 }
    },
    
"cost_actual_usd": 0.28,
    
"governance_report": {
"policy_version": "1.0",
"tier_evaluated": "pro",
"compliance_checked": ["LGPD"],
"consent_verified": ["credit_bureau"],
"data_retention": "ephemeral",
"data_destroyed_at": "2025-01-15T10:30:13.000Z"
    }
  }
}
```

### 7.5 NATS Subject Hierarchy

```
mesh.
├── agents.
│   ├── register                          # Agent registration
│   ├── heartbeat.{agent_id}              # Health checks
│   └── deregister                        # Agent removal
│
├── requests.
│   ├── {domain_l1}.{domain_l2}.{region}  # Capability requests
│   │   Ex: mesh.requests.finance.credit-analysis.br
│   │   Ex: mesh.requests.legal.contract-analysis.latam
│   │   Ex: mesh.requests.nlp.translation.global
│   └── _broadcast                        # Cross-domain requests
│
├── bids.
│   └── {request_id}                      # Bids for specific request
│
├── matches.
│   ├── {consumer_id}                     # Match notifications → consumer
│   └── {provider_id}                     # Match notifications → provider
│
├── tasks.
│   └── {session_id}.
│       ├── accepted
│       ├── progress
│       ├── completed
│       └── failed
│
├── settlement.
│   └── {session_id}.
│       ├── charge
│       ├── confirmed
│       └── disputed
│
└── trust.
└── {agent_id}.
├── rating
└── updated
```

---

## 8. Matching Engine

### 8.1 Matching Pipeline

```
REQUEST RECEIVED
       │
       ▼
┌──────────────┐
│ STAGE 1: │ Eliminatory filters (hard filters)
│  FILTER      │  ─ domain match
│              │  ─ data_residency
│              │  ─ compliance requirements
│              │  ─ security_level
│              │  ─ required_certifications
│              │  ─ agent health == "healthy"
│              │  ─ agent status == "active"
│              │
│ Result: │ Candidates[] (agents that CAN assist)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ STAGE 2: │ Routing for candidates
│ ROUTE │ ─ Post request in specific NATS subject
│ │ ─ Only filtered candidates receive
│ │ ─ Wait for bid_window (ex: 3000ms)
│              │
│ Result: │ Bids[] (offers received)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ STAGE 3: │ Validation of bids
│  VALIDATE    │  ─ Bid within max_cost?
│              │  ─ Estimated latency within max_latency?
│              │  ─ Agent trust_score >= min_trust_score?
│ │ ─ Contract valid hash?
│ │ ─ Valid subscription?
│              │
│ Result: │ ValidBids[] (bids that meet constraints)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  STAGE 4:    │  Scoring and ranking
│  SCORE       │  ─ Composite score = weighted sum
│              │
│ Result: │ RankedBids[] (ordered by score)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ STAGE 5: │ Selection and confirmation
│  SELECT      │  ─ Select top bid
│ │ ─ Create escrow
│              │  ─ Generate session tokens
│              │  ─ Publish match notification
│              │
│  Result:     │  Match confirmed
└──────────────┘
```

### 8.2 Scoring Algorithm

```python
def calculate_bid_score(bid, request, config):
    """
Normalized composite score [0, 1].
Weights are configurable by request or global.
    """
weights = request.scoring_weights or config.default_weights
# Default weights:
#   cost: 0.25, latency: 0.20, trust: 0.30,
#   capability_match: 0.15, compliance: 0.10
    
scores = {}
    
# Cost score: lower cost = higher score
# Normalized against request's max_cost
scores["cost"] = 1.0 - (bid.cost / request.max_cost)
    
# Latency score: lower latency = higher score
scores["latency"] = 1.0 - (bid.estimated_latency / request.max_latency)
    
# Trust score: normalized to [0, 1]
scores["trust"] = bid.agent.trust_score / 5.0
    
# Capability match: semantic similarity of domain + capability
scores["capability_match"] = calculate_domain_similarity(
request.domain,
bid.agent.domains
    )
    
# Compliance match: binary (already filtered, but bonus for extras)
extra_certs = len(bid.agent.certifications - request.required_certs)
scores["compliance"] = min(1.0, 0.8 + (extra_certs * 0.1))
    
# Bonus factors
bonus = 0.0
if bid.context_resolution_plan.cached_available:
bonus += 0.02 # Bonus for having cache (lower real latency)
if bid.agent.domain_experience.get(request.domain, {}).get("tasks", 0) > 1000:
bonus += 0.03 # Bonus for experience in the specific domain
    
# Composite score
total = sum(
scores[key] * weights[key]
for key in scores
    ) + bonus
    
    return min(1.0, total), scores
```

### 8.3 Selection Strategies

```yaml
selection_strategies:
BEST_SCORE:
description: "Selects bid with the highest composite score"
use_case: "Default — best overall balance"
    
LOWEST_COST:
description: "Select bid with lowest cost (among valid ones)"
use_case: "High-volume, cost-sensitive tasks"
    
FASTEST:
description: "Selects bid with lowest estimated latency"
use_case: "Tasks real-time, user-facing"
    
HIGHEST_TRUST:
description: "Selects bid with the highest trust score"
use_case: "Critical tasks, high consequence"
    
ROUND_ROBIN:
description: "Distributes between qualified providers"
use_case: "Testing new providers, load distribution"
    
WEIGHTED_RANDOM:
description: "Selects randomly weighted by score"
use_case: "Avoids winner-takes-all, diversification"
```

---

## 9. Data Plane — Secure Data Exchange

### 9.1 Security Levels

```yaml
security_levels:
OPEN:
description: "Non-sensitive data may pass through the broker"
encryption: "TLS transport only"
data_in_request: true
use_case: "Public text translation, generic classification"
    
STANDARD:
description: "Business data, encrypted direct channel"
encryption: "mTLS + E2E (ECDH + AES-256-GCM)"
data_in_request: false
data_exchange: "gRPC peer-to-peer"
use_case: "Contract analysis, financial data"
    
CONFIDENTIAL:
description: "Sensitive data, processing in TEE"
encryption: "mTLS + E2E + TEE enclave"
data_in_request: false
data_exchange: "gRPC peer-to-peer into TEE"
attestation_required: true
use_case: "Medical data, PII, regulated data"
    
RESTRICTED:
description: "Ultra-sensitive, data does not leave the source"
encryption: "N/A — data does not travel"
data_in_request: false
data_exchange: "Agent code moves to data (sandbox)"
use_case: "Classified government data"
```

### 9.2 E2E Exchange Protocol (STANDARD Level)

```
Consumer                                          Provider
    │                                                │
│  1. Resolve provider's DID Document             │
│ → get public key (X25519) │
    │                                                │
│ 2. Gera ephemeral ECDH keypair │
│     consumer_eph_priv, consumer_eph_pub        │
    │                                                │
│  3. Envia consumer_eph_pub via gRPC handshake  │
    │────────────────────────────────────────────────►│
    │                                                │
│  4. Provider gera ephemeral ECDH keypair       │
│     provider_eph_priv, provider_eph_pub        │
    │                                                │
│ 5. Both derive shared secret via ECDH: │
│     shared = ECDH(my_priv, peer_pub)           │
    │                                                │
│  6. Derivam session key via HKDF:              │
│     session_key = HKDF-SHA384(                 │
│       shared_secret,                           │
│       salt=session_id,                         │
│       info="amp-data-plane-v1"                 │
    │     )                                          │
    │                                                │
│  7. Consumer cifra payload:                    │
│     nonce = random(12 bytes)                   │
│     ciphertext = AES-256-GCM(                  │
│       session_key, nonce, plaintext            │
    │     )                                          │
    │                                                │
│  8. Envia via gRPC stream                      │
│═══════ encrypted payload + nonce ══════════════►│
    │                                                │
│ 9. Provider decrypts, processes │
    │                                                │
│ 10. Provider cipher result │
│◄══════ encrypted result + nonce ═══════════════│
    │                                                │
│ 11. Consumer deciphers result │
    │                                                │
│  12. Both destroy ephemeral keys                │
│      (forward secrecy)                         │
    │                                                │
```

### 9.3 gRPC Service Definition

```protobuf
syntax = "proto3";
package amp.dataplane.v1;

service DataPlane {
// Handshake — exchange of ephemeral keys
  rpc Handshake(HandshakeRequest) returns (HandshakeResponse);
  
// Transfer — sending encrypted payload
  rpc Transfer(stream EncryptedChunk) returns (TransferAck);
  
// Result — receiving encrypted result
  rpc Result(ResultRequest) returns (stream EncryptedChunk);
  
// Bidirectional streaming for long tasks
  rpc StreamingTask(stream EncryptedChunk) returns (stream EncryptedChunk);
}

message HandshakeRequest {
string session_id = 1;
string session_token = 2;           // JWT of the match
bytes consumer_ephemeral_pub = 3;   // X25519 public key
string consumer_did = 4;
bytes consumer_did_signature = 5;   // Proof of identity
}

message HandshakeResponse {
bytes provider_ephemeral_pub = 1;
string provider_did = 2;
bytes provider_did_signature = 3;
  
// Se TEE, including certificate
  optional TEEAttestation attestation = 4;
}

message TEEAttestation {
string tee_type = 1;               // "AWS_NITRO", "INTEL_SGX", etc
bytes attestation_document = 2;     // Signed by hardware
bytes enclave_public_key = 3;       // Enclave public key
repeated bytes pcr_values = 4;      // Platform Configuration Registers
}

message EncryptedChunk {
bytes ciphertext = 1;
bytes nonce = 2;                    // 12 bytes for AES-256-GCM
uint32 sequence = 3;               // For ordering
bool is_end = 4;                  // Last chunk
string algorithm = 5;              // "AES-256-GCM"
}

message TransferAck {
bool accepted = 1;
uint32 chunks_received = 2;
  optional string error_code = 3;
  optional string error_message = 4;
}

message ResultRequest {
string session_id = 1;
}
```

### 9.4 RESTRICTED level — Agent goes to data

```yaml
restricted_flow:
description: |
Data never leaves the consumer infrastructure.
The provider packages its agent as an OCI container
and sends it for execution on the consumer's infrastructure.
  
steps:
1_request:
consumer: "Publish request with security_level=RESTRICTED"
      
2_bid:
provider: "Include agent_image digest and signature in bid"
      
3_match:
broker: "Confirm match normally"
      
4_image_transfer:
provider: "Sends signed OCI image to consumer"
consumer: |
Verify:
- Image signature (cosign/notary)
- Vulnerability scan (trivy/grype)
- Static analysis for exfiltration attempts
- No network syscalls allowed
        
5_sandbox_execution:
consumer: |
Runs in sandbox:
- gVisor / Firecracker microVM
- Network: NONE (no network access)
- Filesystem: READ_ONLY (input mounted)
- Memory: limited (e.g. 2GB)
- CPU: limited (e.g. 2 cores)
- Time: limited (ex: 60s)
- Syscalls: restricted (seccomp profile)
        
6_result:
consumer: "Collect output from sandbox, destroy container"
```

---

## 10. Governance and Access Policies

### 10.1 Governance Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   GOVERNANCE STACK                        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Layer 4: AUDIT & COMPLIANCE                       │  │
│ │ Immutable logging, Merkle tree, compliance reports │ │
│  ├────────────────────────────────────────────────────┤  │
│  │  Layer 3: OUTPUT MASKING                           │  │
│ │ Projects output to caller tier │ │
│  ├────────────────────────────────────────────────────┤  │
│  │  Layer 2: POLICY DECISION (OPA/Rego)               │  │
│ │ Evaluates rules against caller attributes │ │
│  ├────────────────────────────────────────────────────┤  │
│  │  Layer 1: IDENTITY & ATTRIBUTES                    │  │
│  │  DID, trust score, certifications, role            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 10.2 Policy Engine (OPA/Rego)

```rego
# ═══════════════════════════════════════════
# governance.rego — AMP access policies
# ═══════════════════════════════════════════

package amp.governance

import future.keywords.if
import future.keywords.in

# ─── Tier determination ───

default tier := "basic"

tier := "regulator" if {
input.caller.role == "regulator"
"BACEN_AUDIT" in input.caller.certifications
}

tier := "enterprise" if {
input.caller.trust_score >= 4.5
input.caller.contract_tier == "enterprise"
}

tier := "pro" if {
input.caller.trust_score >= 4.0
some cert in ["SOC2", "ISO27001"]
cert in input.caller.certifications
}

# ─── Purpose check ───

default purpose_allowed := false

purpose_allowed if {
input.request.purpose in input.contract.constraints.purpose_limitation
}

# ─── Residency date check ───

default residency_compliant := false

residency_compliant if {
input.provider.location in input.request.constraints.data_residency
}

# ─── Consent check ───

default consent_valid := false

consent_valid if {
token := input.request.consent_proofs[input.dependency_key]
io.jwt.verify_rs256(token, input.trusted_keys)
payload := io.jwt.decode(token)
payload[2].purpose == input.request.purpose
time.now_ns() < payload[2].exp * 1000000000
}

# ─── Masking decision ───

allowed_fields[field] if {
t := tier
field := input.contract.output.tier_projections[t].fields[_]
}

# Special case: wildcard
allowed_fields[field] if {
t := tier
"*" in input.contract.output.tier_projections[t].fields
field := input.contract.output.base_schema.properties[_]
}

# ─── Final decision ───

decision := {
"allowed": purpose_allowed,
"tier": tier,
"allowed_fields": allowed_fields,
"residency_ok": residency_compliant,
"consent_ok": consent_valid,
"reasons": reasons,
}

reasons[msg] if {
not purpose_allowed
msg := "Purpose not in allowed list"
}

reasons[msg] if {
not residency_compliant
msg := sprintf("Provider location %v not in allowed residency %v",
                   [input.provider.location, input.request.constraints.data_residency])
}
```

### 10.3 Output Masking — Implementation

```python
from typing import Any

class OutputMaskingEngine:
    """
Projects raw output from the agent to the schema
permitted tier of the caller.
    
Run NO PROVIDER (or TEE) — never broker.
    """
    
def mask(
self,
raw_output: dict[str, Any],
governance_decision: dict,
contract: dict
    ) -> dict[str, Any]:
        
tier = governance_decision["tier"]
allowed_fields = governance_decision["allowed_fields"]
        
# Projeta output
masked = {}
redacted = []
        
for key, value in raw_output.items():
if key in allowed_fields or "*" in allowed_fields:
masked[key] = value
else:
redacted.append(key)
        
# Add governance metadata
masked["_governance"] = {
"tier_applied": tier,
"policy_version": contract["metadata"]["version"],
"redacted_fields": redacted,
"redacted_count": len(redacted),
"compliance_checked": contract["spec"]["constraints"]["compliance"],
"purpose_verified": governance_decision.get("purpose_allowed", False),
"consent_verified": governance_decision.get("consent_ok", False),
"data_retention": contract["spec"]["constraints"]["retention_policy"],
"timestamp": datetime.utcnow().isoformat(),
"governance_hash": self._hash_decision(governance_decision)
        }
        
# Se tier permite additional fields (ex: regulator)
tier_config = contract["spec"]["output"]["tier_projections"].get(tier, {})
if "additional" in tier_config:
for additional_key in tier_config["additional"]:
if additional_key == "full_audit_trail":
masked["_audit_trail"] = self._generate_audit_trail()
elif additional_key == "model_explainability":
masked["_explainability"] = self._generate_explainability()
        
        return masked
    
def _hash_decision(self, decision: dict) -> str:
"""Governance decision hash for audit trail."""
        import hashlib, json
canonical = json.dumps(decision, sort_keys=True)
        return f"sha256:{hashlib.sha256(canonical.encode()).hexdigest()}"
```

### 10.4 Consent Management

```yaml
consent_specification:
format: "JWT (RFC 7519)"
signing: "RS256 or ES256"
  
required_claims:
iss: "DID of the data subject"
sub: "Reference to data (ex: CNPJ)"
aud: "Agent's DID or 'amp:any'"
exp: "Expiration of consent"
iat: "Issuance date"
purpose: "Authorized purpose (must match purpose_limitation)"
scope: "Scope of authorized data"
    
  optional_claims:
delegated_by: "If consent was delegated"
restrictions: "Additional restrictions"
revocation_endpoint: "URL to check revocation"
    
example:
header:
alg: "ES256"
typ: "JWT"
kid: "did:mesh:org:empresa-xyz#consent-key-1"
payload:
iss: "did:mesh:org:empresa-xyz"
under: "cnpj:12.345.678/0001-90"
aud: "amp:domain:data.credit-bureau"
exp: 1737100800
iat: 1736496000
purpose: "credit-assessment"
scope: "score,restrictions,payment_history"
      
verification_flow:
1: "Provider receives consent JWT in input"
2: "Resolve issuer's DID → obtain public key"
3: "Verifies JWT signature"
4: "Check exp (not expired)"
5: "Check purpose (match with task)"
6: "Check scope (covers requested data)"
7: "Optional: check revocation_endpoint"
8: "If everything OK → proceed with data fetch"
```

---

## 11. Economic System

### 11.1 Pricing Models

```yaml
pricing_models:
per_request:
description: "Charge per processed request"
billing_unit: "request"
best_for: "Discrete tasks with predictable cost"
    
per_token:
description: "Charges for processed tokens (input + output)"
billing_unit: "1K tokens"
best_for: "NLP/LLM tasks with size variation"
    
per_minute:
description: "Charge for processing time"
billing_unit: "minute"
best_for: "Heavy processing tasks (video, simulation)"
    
tiered_subscription:
description: "Monthly subscription with volume included"
billing_unit: "month"
best_for: "High volume consumers"
    
dynamic:
description: "Price varies with supply/demand in real time"
billing_unit: "request"
best_for: "Mature market with multiple providers"
```

### 11.2 Escrow and Settlement

```
PAYMENT FLOW:

1. MATCH
   │
├── Broker creates escrow
│ ├── Debit consumer (pre-authorization)
│   └── Amount: bid.cost_usd
   │
2. EXECUTION
   │
├── If completed successfully:
│ ├── Consumer has dispute_window (300s) to dispute
│ ├── If you do not dispute → escrow releases to provider
│   └── Mesh fee: 5-15% of amount (mesh revenue)
   │
├── If failure/timeout:
│   ├── Escrow refund to consumer
│ └── Provider penalized in trust score
   │
└── If disputed:
├── Frozen Escrow
├── Evidence collected (audit trail)
├── Resolution: automatic (SLA check) or manual (arbitration)
└── Result: refund, partial payment, or full payment
```

```yaml
settlement_rules:
mesh_fee:
percentage: 10 # 10% of the transaction value
minimum_usd: 0.01
cap_usd: 10.00
    
escrow:
hold_method: "pre_authorization"
hold_duration_max: "5m"
release_condition: "completion + no_dispute"
dispute_window: "300s"
auto_release: true # Automatically release if no dispute
    
sla_penalties:
enabled_for: ["enterprise"]
latency_violation:
threshold: "agreed_max_latency * 1.5"
penalty: "50% refund"
availability_violation:
threshold: "3 failures in 1 hour"
penalty: "auto_suspend + 100% refund"
accuracy_dispute:
resolution: "manual_arbitration"
max_resolution_time: "72h"
```

### 11.3 Trust Score Algorithm

```python
class TrustScoreEngine:
    """
Score from 0.0 to 5.0, updated after each task.
Combines multiple signals with temporal decay.
    """
    
def calculate_trust_score(self, agent_id: str) -> float:
history = self.get_agent_history(agent_id)
        
# Component 1: Success Rate (weight: 30%)
success_rate = self._weighted_success_rate(history)
        
# Component 2: Average Ratings (weight: 25%)
avg_rating = self._time_decayed_avg_rating(history)
        
# Component 3: SLA Compliance (weight: 20%)
sla_score = self._sla_compliance_score(history)
        
# Component 4: Volume & Consistency (weight: 15%)
volume_score = self._volume_consistency_score(history)
        
# Component 5: Recency (weight: 10%)
recency_score = self._recency_score(history)
        
raw_score = (
success_rate * 0.30 +
avg_rating * 0.25 +
sla_score * 0.20 +
volume_score * 0.15 +
recency_score * 0.10
        )
        
# Normalize to [0, 5]
        return round(min(5.0, max(0.0, raw_score * 5.0)), 2)
    
def _weighted_success_rate(self, history):
"""Success rate with greater weight for recent tasks."""
if not history.tasks:
            return 0.5  # Neutral prior for new agents
        
weights = []
successes = []
for task in history.tasks:
age_days = (now() - task.completed_at).days
weight = math.exp(-age_days / 90)  # Decay 90 dias
weights.append(weight)
successes.append(1.0 if task.status == "completed" else 0.0)
        
        return np.average(successes, weights=weights)
    
def _time_decayed_avg_rating(self, history):
"""Average ratings with temporal decay."""
if not history.ratings:
            return 0.5  # Prior neutro
        
weighted_sum = 0.0
weight_sum = 0.0
for rating in history.ratings:
age_days = (now() - rating.created_at).days
weight = math.exp(-age_days / 180)  # Decay 6 meses
weighted_sum += (rating.score / 5.0) * weight
weight_sum += weight
        
        return weighted_sum / weight_sum if weight_sum > 0 else 0.5
```

---

## 12. Observability and Audit Trail

### 12.1 Audit Record Schedule

```json
{
"audit_version": "1.0",
"record_id": "audit-01JAXYZ-uuid",
"timestamp": "2025-01-15T10:30:15.000Z",
"session_id": "01JAXYZ-session-uuid",
"correlation_id": "01JAXYZ123-flow-uuid",
  
"participants": {
"consumer": {
"did": "did:mesh:agent:fintech-xyz-orchestrator",
"org": "did:mesh:org:fintech-xyz",
"location": "BR"
    },
"provider": {
"did": "did:mesh:agent:credit-analyzer-br-001",
"org": "did:mesh:org:legaltech-abc",
"location": "BR"
    },
"broker": {
"did": "did:mesh:broker:br-southeast-1"
    }
  },
  
"task": {
"domain": ["finance", "credit-analysis"],
"capability": "credit-risk-assessment",
"security_level": "STANDARD",
"input_hash": "sha256:abc123...",
"output_hash": "sha256:def456...",
"contract_hash": "sha256:a1b2c3..."
  },
  
"governance": {
"tier_applied": "pro",
"policy_version": "1.0",
"purpose_checked": "credit-assessment",
"purpose_allowed": true,
"consent_verified": ["credit_bureau"],
"residency_verified": true,
"fields_delivered": 8,
"fields_redacted": 3,
"compliance": ["LGPD"]
  },
  
"performance": {
"total_latency_ms": 8300,
"context_resolution_ms": 2000,
"processing_ms": 6300,
"bids_received": 3,
"bids_valid": 2,
"match_score": 0.92
  },
  
"settlement": {
"cost_usd": 0.28,
"mesh_fee_usd": 0.028,
"escrow_id": "01JAXYZ-escrow-uuid",
"settled_at": "2025-01-15T10:30:45.000Z"
  },
  
"data_handling": {
"retention_policy": "ephemeral",
"data_destroyed_at": "2025-01-15T10:30:13.000Z",
"tee_used": false,
"encryption": "AES-256-GCM"
  },
  
"integrity": {
"record_hash": "sha256:j1k2l3...",
"previous_hash": "sha256:x7y8z9...",
"broker_signature": "ed25519:base64...",
"merkle_root": "sha256:m1n2o3...",
"blockchain_anchor": null
  }
}
```

### 12.2 Merkle Tree for Integrity

```
Merkle Root
                   (sha256:m1n2o3)
                   /              \
Hash AB              Hash CD
             /      \            /      \
Hash A    Hash B    Hash C    Hash D
           │         │         │         │
Audit      Audit     Audit     Audit
Rec 1      Rec 2     Rec 3     Rec 4

- Any tampering with a registry invalidates Merkle Root
- Merkle Root anchored to public blockchain periodically (optional)
- Any participant can check integrity of any record
- Proof of inclusion: O(log n) — efficient even with millions of records
```

### 12.3 Metrics and Observability

```yaml
metrics:
# Control Plane
amp_requests_total:
    type: counter
labels: [domain, region, status]
    
amp_bids_total:
    type: counter
labels: [domain, region, status]
    
amp_match_latency_ms:
    type: histogram
labels: [domain, selection_strategy]
buckets: [10, 50, 100, 500, 1000, 3000, 5000]
    
amp_bid_window_utilization:
    type: histogram
description: "Percentage of bid window used before match"
    
# Data Plane
amp_task_duration_ms:
    type: histogram
labels: [domain, provider, security_level]
    
amp_task_cost_usd:
    type: histogram
labels: [domain, tier]
    
amp_context_resolution_ms:
    type: histogram
labels: [dependency_key, source]
    
# Trust
amp_trust_score:
    type: gauge
labels: [agent_id, domain]
    
amp_success_rate:
    type: gauge
labels: [agent_id, domain, window]
    
# Settlement
amp_settlement_total_usd:
    type: counter
labels: [status]
    
amp_disputes_total:
    type: counter
labels: [resolution]

# Exported via OpenTelemetry Protocol (OTLP)
# Compatible with Prometheus, Grafana, Datadog
```

---

## 13. SDK Specification

### 13.1 Python SDK

```python
"""
Agent Mesh Protocol — Python SDK
═══════════════════════════════════
"""

from agent_mesh import (
MeshClient,
AgentProvider,
ContextContract,
SecurityLevel,
PricingTier,
)

# ═══════════════════════════════════════════════════
# CONSUMER SIDE — Who needs capabilities
# ═══════════════════════════════════════════════════

class ConsumerExample:
    
def __init__(self):
self.mesh = MeshClient(
did="did:mesh:agent:my-orchestrator",
private_key_path="./keys/private.pem",
broker_url="nats://broker.mesh.global:4222",
region="br-southeast-1"
        )
    
async def analyze_credit(self, company_data: dict) -> dict:
"""Complete example of request to mesh."""
        
result = await self.mesh.request(
# WHAT do I need
domain=["finance", "credit-analysis"],
capability="credit-risk-assessment",
            
# DATA I provide (caller_provided)
input={
"company_financials": {
"company_cnpj": company_data["cnpj"],
"company_name": company_data["name"],
"sector": company_data["sector"],
"revenue_12m": company_data["revenue"],
"ebitda_12m": company_data["ebitda"],
"debt_total": company_data["debt"],
"cash_and_equivalents": company_data["cash"],
"payment_history": company_data["payments"],
                },
"risk_appetite": {
"max_exposure": 500_000,
"preferred_risk_level": "moderate",
"industry_restrictions": ["gambling"],
                },
"consent_proofs": {
"credit_bureau": self._get_consent_jwt(company_data["cnpj"]),
"data_processing": self._get_lgpd_consent(company_data["cnpj"]),
                },
            },
            
# CONSTRAINTS
            constraints={
"max_latency_ms": 30_000,
"max_cost_usd": 0.50,
"min_trust_score": 4.0,
"data_residency": ["BR"],
"compliance": ["LGPD"],
"security_level": SecurityLevel.STANDARD,
            },
            
# PURPOSE (verified by governance)
purpose="credit-assessment",
            
# HOW do I want to receive bids
bid_config={
"window_ms": 3000,
"selection_strategy": "BEST_SCORE",
            },
        )
        
# Result is already governed (tier applied, fields masked)
        return {
"score": result.data["risk_score"],
"level": result.data["risk_level"],
"risks": result.data.get("key_risks", []),
"justification": result.data.get("justification"),
"confidence": result.data.get("confidence"),
"governance": result.data["_governance"],
"cost": result.cost_usd,
"latency_ms": result.latency_ms,
"provider": result.provider_did,
"session_id": result.session_id,
        }
    
async def rate_result(self, session_id: str, score: int, comment: str):
"""Evaluate the result received."""
await self.mesh.rate(
session_id=session_id,
score=score,           # 1-5
comment=how,
dimensions={
"accuracy": 5,
"latency": 4,
"completeness": 5,
            }
        )


# ═══════════════════════════════════════════════════
# PROVIDER SIDE — Who offers capabilities
# ═══════════════════════════════════════════════════

class CreditAnalyzerProvider:
    
def __init__(self):
self.provider = AgentProvider(
did="did:mesh:agent:credit-analyzer-br-001",
private_key_path="./keys/private.pem",
broker_url="nats://broker.mesh.global:4222",
region="br-southeast-1"
        )
        
# Register the agent card
self.provider.register(
card_path="./agent_card.yaml",
contract_path="./context_contract.yaml"
        )
    
async def start(self):
"""Start the provider — start receiving tasks."""
        
@self.provider.capability(
id="credit-risk-assessment",
domains=["finance", "credit-analysis"],
        )
async def handle_credit_analysis(task):
            """
Handler principal.
'task' already comes with full context:
- task.caller_input (caller data, validated)
- task.external_context (deps resolved by mesh)
- task.session (session metadata)
- task.governance (tier, applicable policies)
            """
            
# 1. Extract data
financials = task.caller_input["company_financials"]
risk_appetite = task.caller_input["risk_appetite"]
            
selic = task.external_context["selic_rate"]
sector = task.external_context.get("sector_analysis")
bureau = task.external_context.get("credit_bureau_score")
            
# 2. Process with proprietary model
raw_result = self.my_scoring_model.predict(
financials=financials,
selic=selic,
sector_data=sector,
office_data=office,
risk_appetite=risk_appetite
            )
            
# 3. Return raw result
# (masking will be applied automatically by the SDK
# based on caller's tier)
            return {
"risk_score": raw_result.score,
"risk_level": raw_result.level,
"max_recommended_exposure": raw_result.max_exposure,
"key_risks": raw_result.risks,
"mitigating_factors": raw_result.mitigators,
"justification": raw_result.narrative,
"confidence": raw_result.confidence,
"signal_breakdown": raw_result.signals,
"confidence_intervals": raw_result.ci,
"model_metadata": {
"model_version": "3.2.1",
"features_used": raw_result.features,
"decision_path": raw_result.path,
                },
"data_sources_used": self._list_sources(task),
            }
        
@self.provider.bid_evaluator
async def should_bid(request):
            """
Evaluates whether this agent should bid for a request.
Returns None to not bid, or Bid to do so.
            """
# Customized checks
sector = request.input_manifest.get("sector")
if sector in self.excluded_sectors:
                return None  # I don't bid for sectors I don't cover
            
# Estimate cost and latency
estimated_cost = self._estimate_cost(request)
estimated_latency = self._estimate_latency(request)
            
if estimated_cost > request.constraints.max_cost_usd:
                return None  # I can't fulfill at this price
            
            return Bid(
cost_usd=estimated_cost,
estimated_latency_ms=estimated_latency,
confidence_estimate=0.87,
            )
        
# Start listening
await self.provider.listen()


# ═══════════════════════════════════════════════════
# INITIALIZATION
# ═══════════════════════════════════════════════════

if __name__ == "__main__":
    import asyncio
    
# Provider
provider = CreditAnalyzerProvider()
asyncio.run(provider.start())
    
# Consumer (in another process/service)
consumer = ConsumerExample()
result = asyncio.run(consumer.analyze_credit({
"cnpj": "12.345.678/0001-90",
"name": "Empresa ABC Ltda",
"sector": "varejo",
"revenue": 5_000_000,
"bitda": 800_000,
"debt": 1_200_000,
"cash": 500_000,
"payments": [
            {"date": "2024-06-01", "amount": 50000, "days_late": 0},
            {"date": "2024-09-01", "amount": 50000, "days_late": 5},
            {"date": "2024-12-01", "amount": 50000, "days_late": 0},
        ]
    }))
print(result)
```

### 13.2 TypeScript SDK (Resumido)

```typescript
import { MeshClient, SecurityLevel } from '@agent-mesh/sdk';

// Consumer
const mesh = new MeshClient({
did: 'did:mesh:agent:my-app',
privateKeyPath: './keys/private.pem',
brokerUrl: 'nats://broker.mesh.global:4222',
});

const result = await mesh.request({
domain: ['finance', 'credit-analysis'],
capability: 'credit-risk-assessment',
purpose: 'credit-assessment',
input: { company_financials: { /* ... */ } },
  constraints: {
maxLatencyMs: 30_000,
maxCostUsd: 0.50,
minTrustScore: 4.0,
dataResidency: ['BR'],
securityLevel: SecurityLevel.STANDARD,
  },
});

console.log(result.data.risk_score);
console.log(result.data._governance.tier_applied);
```

### 13.3 CLI Tool

```bash
# Register an agent
amp agent register --card ./agent_card.yaml --contract ./context_contract.yaml

# Verify status
amp agent status did:mesh:agent:credit-analyzer-br-001

# Make manual request (debug/test)
amp request \
--domain finance.credit-analysis \
--purpose credit-assessment \
--input ./test_input.json \
--constraints '{"max_cost_usd": 0.50, "data_residency": ["BR"]}' \
--output ./result.json

# Check audit trail
amp audit verify --session-id 01JAXYZ-session-uuid

# Consult trust score
amp trust score did:mesh:agent:credit-analyzer-br-001

# List available agents
amp registry search --domain finance --region BR --min-trust 4.0
```

---

## 14. Deployment and Operation

### 14.1 Mesh Broker Infrastructure

```yaml
# docker-compose.yml (local development)

version: '3.9'

services:
# ── NATS Cluster (Control Plane) ──
nats-1:
image: nats:2.10-alpine
command: >
--name nats-1
--cluster nats://0.0.0.0:6222
--routes nats://nats-2:6222,nats://nats-3:6222
--js  # JetStream enabled
--sd /data
ports:
- "4222:4222"   # Client
- "8222:8222"   # Monitoring
volumes:
- nats-1-data:/data
- ./nats.conf:/etc/nats/nats.conf

nats-2:
image: nats:2.10-alpine
command: >
--name nats-2
--cluster nats://0.0.0.0:6222
--routes nats://nats-1:6222,nats://nats-3:6222
--js --sd /data
volumes:
- nats-2-data:/data

nats-3:
image: nats:2.10-alpine
command: >
--name nats-3
--cluster nats://0.0.0.0:6222
--routes nats://nats-1:6222,nats://nats-2:6222
--js --sd /data
volumes:
- nats-3-data:/data

# ── Matching Engine ──
matching-engine:
build: ./services/matching-engine
environment:
NATS_URL: nats://nats-1:4222
REGISTRY_URL: http://registry:8080
TRUST_URL: http://trust-engine:8080
depends_on: [nats-1, registry, trust-engine]

# ── Registry ──
registry:
build: ./services/registry
environment:
DATABASE_URL: postgres://amp:amp@postgres:5432/amp_registry
NATS_URL: nats://nats-1:4222
depends_on: [postgres, nats-1]

# ── Trust Engine ──
trust-engine:
build: ./services/trust-engine
environment:
DATABASE_URL: postgres://amp:amp@postgres:5432/amp_trust
REDIS_URL: redis://redis:6379
NATS_URL: nats://nats-1:4222
depends_on: [postgres, redis, nats-1]

# ── Governance Engine (OPA) ──
opa:
image: openpolicyagent/opa:latest
command: run --server --set=decision_logs.console=true /policies
ports:
- "8181:8181"
volumes:
- ./policies:/policies

# ── Settlement Service ──
settlement:
build: ./services/settlement
environment:
DATABASE_URL: postgres://amp:amp@postgres:5432/amp_settlement
NATS_URL: nats://nats-1:4222
STRIPE_KEY: ${STRIPE_SECRET_KEY}
depends_on: [postgres, nats-1]

# ── Audit Service ──
audit:
build: ./services/audit
environment:
DATABASE_URL: postgres://amp:amp@postgres:5432/amp_audit
NATS_URL: nats://nats-1:4222
depends_on: [postgres, nats-1]

# ── Infrastructure ──
postgres:
image: postgres:16-alpine
environment:
POSTGRES_USER: amp
POSTGRES_PASSWORD: amp
POSTGRES_DB: amp_registry
volumes:
- postgres-data:/var/lib/postgresql/data
- ./init.sql:/docker-entrypoint-initdb.d/init.sql

redis:
image: redis:7-alpine
volumes:
- redis-data:/data

# ── Observability ──
prometheus:
image: prom/prometheus:latest
volumes:
- ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml

grafana:
image: grafana/grafana:latest
ports:
- "3000:3000"
volumes:
- ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards

volumes:
nats-1-data:
nats-2-data:
nats-3-data:
postgres-data:
redis-data:
```

### 14.2 Production — Kubernetes

```yaml
# Helm chart values (resumido)

amp:
global:
region: "br-southeast-1"
environment: "production"
  
nats:
replicas: 3
jetstream:
enabled: true
storage: 50Gi
gateway:
enabled: true
routes:
- name: us-east-1
url: nats://nats-gateway.us-east-1.mesh.global:7222
- name: eu-west-1
url: nats://nats-gateway.eu-west-1.mesh.global:7222
  
matching-engine:
replicas: 3
resources:
requests: { cpu: 500m, memory: 512Mi }
limits: { cpu: 2000m, memory: 2Gi }
hpa:
minReplicas: 3
maxReplicas: 20
targetCPU: 70
  
registry:
replicas: 2
database:
host: amp-postgres-primary.rds.amazonaws.com
      
trust-engine:
replicas: 2
cache:
redis:
mode: cluster
nodes: 6
  
governance:
opa:
replicas: 3
policies:
syncInterval: 30s
source: "s3://amp-policies/production/"
  
settlement:
replicas: 2
paymentProvider: stripe
    
audit:
replicas: 2
merkleAnchor:
enabled: true
interval: "10m"
target: "ethereum" # or "polygon" for lower costs
  
monitoring:
prometheus: true
grafana: true
alertmanager: true
tracing:
provider: "jaeger"
sampling: 0.1  # 10% of requests
```

---

## 15. Security — Threat Model

### 15.1 Threat Model

```
THREAT MITIGATION SEVERITY
─────────────────────────────────────────────────────────────────────────────

T1: Compromised Broker Broker is data blind.         HIGH
Attacker gains access Only sees matching metadata.
to the broker Data travels P2P with E2E.
Impact: metadata leak,
matching disruption.

T2: Provider malicioso          Trust scores + ratings.           HIGH
Provider steals TEE data for sensitive data.
or returns garbage Audit trail detects patterns.
Escrow protects payment.

T3: Malicious consumer          Rate limiting by DID.            MEDIUM
Request spam, Escrow requires pre-authorization.
DDoS in matching Bilateral reputation.

T4: Man-in-the-middle           mTLS + E2E encryption.            HIGH
Interception in ECDH ephemeral keys.
data plane                  DID verification.

T5: Replay attack Nonce on each message.           MEDIUM
Forwarding of messages Timestamps + window check.
previous unique Session IDs (UUID v7).

T6: Sybil attack                DID registration with             MEDIUM
Create multiple organization verification agents.
fakes to manipulate Trust score starts low.
reputation Verifiable certifications.

T7: Data exfiltration           Security levels (RESTRICTED).     HIGH
Provider extracts TEE attestation data.
for unauthorized use Audit trail + limitation purpose.
Sandbox for RESTRICTED level.

T8: Contract manipulation Contracts are hashed and MEDIUM
Change contract after versioning. Hash in DID.
record to change Broker checks hash in
governance rules for each match.

T9: Denial of service           NATS rate limiting.               MEDIUM
no control plane            Multiple broker instances.
Geographic distribution.

T10: Key compromise             Key rotation via DID update.      HIGH
Ephemeral keys private key limit blast
Leaked agent               radius. Revocation list.
```

### 15.2 Security Checklist for Providers

```
PRE-DEPLOYMENT:
□ Generate Ed25519 keys in HSM or secure enclave
□ Create DID Document with key rotation plan
□ Implement rate limiting on data plane endpoint
□ Configure TLS 1.3 with approved cipher suites
□ If using TEE: validate attestation flow end-to-end
□ Audit: verify that business data is NEVER logged
□ Implement data destruction after processing
□ gRPC endpoint penetration testing

OPERATIONAL:
□ Monitor failed authentication attempts
□ Rotate keys every 90 days
□ Check integrity of the agent card in the registry
□ Monitor latency deviations (may indicate exfiltration)
□ Audit trail backup with Merkle verification
```

---

## 16. Implementation Roadmap

### 16.1 Phases

```
PHASE 0 — FOUNDATION (Weeks 1-4)
════════════════════════════════
Objective: Basic infrastructure working

Deliverables:
├── NATS local cluster (3 nodes) with JetStream
├── Schema definitions (protobuf + JSON Schema)
├── DID generation and verification library
├── CloudEvents wrapper with AMP extensions
├── Tests: published and received messages
└── Basic CI/CD pipeline

Tech:
Python + async, NATS.py, protobuf, pytest


PHASE 1 — MVP CORE (Weeks 5-10)
════════════════════════════════
Objective: Request → Bid → Match → Execute working E2E

Deliverables:
├── Registry service (CRUD of Agent Cards)
├── Matching Engine (filter + score + select)
├── Basic SDK: mesh.register(), mesh.request(), mesh.listen()
├── Data plan: gRPC with TLS (no E2E encryption yet)
├── 2 agents mock (echo agent + simple NLP agent)
├── Context Contract: caller_provided only (no external deps)
└── Tests: full flow happy path

Accepted limitations:
⚠️ No E2E encryption (TLS only)
⚠️ No governance tiers (full output)
⚠️ No settlement (free)
⚠️ No trust scores (fixed at 5.0)
⚠️ Single region


PHASE 2 — SECURITY AND GOVERNANCE (Weeks 11-16)
════════════════════════════════════════════════
Objective: Viable production for business data

Deliverables:
├── E2E encryption (ECDH + AES-256-GCM)
├── Governance engine (OPA/Rego integration)
├── Output masking by tier
├── Consent verification (JWT)
├── Audit trail with Merkle tree
├── Trust score engine (basic)
├── Context Contract: external_dependencies resolution
├── Cache layer for dependencies (NATS KV + Redis)
└── 2 real agents (e.g. OCR + text classification)


PHASE 3 — ECONOMY AND SCALE (Weeks 17-24)
═══════════════════════════════════════════
Objective: Economically sustainable, multi-region

Deliverables:
├── Settlement service (Stripe integration)
├── Escrow flow completo
├── Billing dashboard for providers
├── Multi-region NATS (super cluster: BR + US)
├── CLI tool (amp register, amp request, amp audit)
├── Documentation site
├── 5+ real agents in production
└── Beta program with early adopters


PHASE 4 — MATURITY (Weeks 25-36)
════════════════════════════════════
Objective: Complete and reliable platform

Deliverables:
├── TEE support (AWS Nitro)
├── RESTRICTED security level (agent goes to data)
├── TypeScript SDK
├── Go SDK
├── Agent marketplace UI
├── Advanced analytics for providers
├── Dispute resolution system
├── Blockchain anchoring for audit trail
├── SLA monitoring and penalties
└── Enterprise onboarding program


PHASE 5 — ECOSYSTEM (Month 9+)
══════════════════════════════
Objective: Network effects and organic growth

Deliverables:
├── Visual pipeline builder (drag & drop agents)
├── Agent templates e boilerplates
├── Certification program for providers
├── Partner program
├── Community governance (protocol evolution)
├── Agent-to-agent negotiation protocol
├── Dynamic pricing (supply/demand based)
└── Global coverage (5+ regions)
```

### 16.2 Success Metrics by Phase

| Phase | Metric | Target |
|------|---------|--------|
| 0 | Infra running, tests passing | 100% green testing |
| 1 | E2E flow working | <5s total latency, 2 agents |
| 2 | Security validated | Pentest without criticals, OPA policies active |
| 3 | First recipe | 10 providers, 50 consumers, $1K MRR |
| 4 | Scale | 100 providers, 500 consumers, $50K MRR |
| 5 | Network effects | Organic growth >20% m/m |

---

## 17. Glossary

| Term | Definition |
|-------|-----------|
| **Agent** | Standalone software that offers or consumes capabilities on the AMP network |
| **Agent Card** | Public document that describes an agent's capabilities, limits and endpoints |
| **AMP** | Agent Mesh Protocol — this specification |
| **Bid** | Offer of a provider to meet a specific request |
| **Broker** | Central infrastructure that routes messages on the control plane |
| **Caller** | The consumer that originates a request |
| **Consumer** | Agent that requests capabilities from other agents |
| **Context Contract** | Formal specification of an agent's context dependencies |
| **Control Plane** | Messaging layer for orchestration (requests, bids, matches) |
| **Data Plane** | Peer-to-peer channel for exchanging business data |
| **DID** | Decentralized Identifier — verifiable identity without central authority |
| **E2E** | End-to-End encryption |
| **Escrow** | Temporary payment hold until delivery confirmation |
| **Governance** | Access control, compliance and audit system |
| **Match** | Selection of a provider to fulfill a request |
| **Mesh** | The global network of agents connected via AMP |
| **Provider** | Agent offering capabilities on the network |
| **Request** | Publication of capacity needs by a consumer |
| **Session** | Temporary context of a request→result interaction |
| **Settlement** | Financial settlement process after execution |
| **TEE** | Trusted Execution Environment — secure hardware |
| **Tier** | Access level that determines what data the caller receives |
| **Trust Score** | Reputation score [0-5] based on history |

---

## 18. Appendices

### Appendix A: References and Standards Used

| Standard | Usage in AMP |
|--------|-----------|
| [CloudEvents v1.0](https://cloudevents.io/) | Message format |
| [W3C DID Core](https://www.w3.org/TR/did-core/) | Decentralized identity |
| [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/) | Verifiable certifications |
| [NATS Protocol](https://docs.nats.io/) | Control plane messaging |
| [gRPC](https://grpc.io/) | Data plane transport |
| [Open Policy Agent](https://www.openpolicyagent.org/) | Policy engine |
| [JSON Schema](https://json-schema.org/) | Schema validation |
| [JWT (RFC 7519)](https://datatracker.ietf.org/doc/html/rfc7519) | Auth tokens, consent proofs |
| [ECDH (RFC 6090)](https://datatracker.ietf.org/doc/html/rfc6090) | Key agreement |
| [AES-GCM (NIST SP 800-38D)](https://csrc.nist.gov/publications/detail/sp/800-38d/final) | Payload encryption |
| [OpenTelemetry](https://opentelemetry.io/) | Observabilidade |
| [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree) | Audit trail integrity |

### Appendix B: Error Codes

```yaml
error_codes:
# Request errors (1xxx)
1001: "INVALID_REQUEST_SCHEMA"
1002: "MISSING_REQUIRED_FIELD"
1003: "INVALID_DOMAIN"
1004: "PURPOSE_NOT_ALLOWED"
1005: "CONSTRAINTS_UNSATISFIABLE"
  
# Context errors (2xxx)
2001: "CONTEXT_MISSING_REQUIRED"
2002: "CONTEXT_VALIDATION_FAILED"
2003: "CONSENT_INVALID"
2004: "CONSENT_EXPIRED"
2005: "EXTERNAL_DEPENDENCY_FAILED"
2006: "CONTEXT_RESOLUTION_TIMEOUT"
  
# Matching errors (3xxx)
3001: "NO_PROVIDERS_AVAILABLE"
3002: "NO_VALID_BIDS"
3003: "BID_WINDOW_EXPIRED"
3004: "MATCH_CONFLICT"
  
# Execution errors (4xxx)
4001: "TASK_TIMEOUT"
4002: "TASK_FAILED"
4003: "PROVIDER_UNAVAILABLE"
4004: "DATA_PLANE_ERROR"
4005: "ENCRYPTION_ERROR"
4006: "TEE_ATTESTATION_FAILED"
  
# Governance errors (5xxx)
5001: "ACCESS_DENIED"
5002: "TIER_INSUFFICIENT"
5003: "RESIDENCY_VIOLATION"
5004: "COMPLIANCE_CHECK_FAILED"
  
# Settlement errors (6xxx)
6001: "ESCROW_FAILED"
6002: "PAYMENT_DECLINED"
6003: "DISPUTE_OPENED"
6004: "SLA_VIOLATION"
```

### Appendix C: Complete Example — End-to-End Flow

```
SCENARIO: Fintech requests credit analysis

COMPONENT EVENT TIME
─────    ──────                              ──────────
T+0ms    Consumer publica request             SDK Consumer
NATS subject: mesh.requests.         NATS
finance.credit-analysis.br

T+50ms   Matching engine receives request     Matching Engine
Filter: 5 agents in the domain
3 pass hard filters
Publishes for 3 candidates

T+100ms Agent BR-001 evaluates and bids Provider SDK
T+200ms Agent BR-002 evaluates and bids Provider SDK
T+800ms Agent BR-003 evaluates, does not bid Provider SDK
         (does not meet data_residency)

T+3000ms Bid window fecha                     Matching Engine
2 valid bids received
Scoring: BR-001=0.92, BR-002=0.85
Winner: BR-001

T+3050ms Match published                      Matching Engine
Escrow created ($0.30) Settlement
Session token generated

T+3100ms Consumer and BR-001 receive match    NATS → SDKs

T+3200ms ECDH handshake via gRPC              Data Plane
Session key derivada

T+3400ms Context resolution inicia            Provider SDK
→ selic_rate: cache hit (50ms)
→ sector_analysis: fresh fetch
→ publishes sub-request on mesh
→ market agent responds (1200ms)
→ credit_bureau: fresh fetch (800ms)
→ economic_indicators: cache hit (30ms)

T+5600ms Context resolution completa          Provider SDK
Package assembled with caller + external

T+5650ms Governance: tier=pro rated OPA

T+5700ms Modelo de scoring processa           Provider internal

T+8300ms Result generated Provider internal
Output masking aplicado (tier=pro)   SDK/Governance
Result encrypted with session key

T+8400ms Encrypted result sent via gRPC Data Plane

T+8450ms Consumer receives and decrypts Consumer SDK
Context data destroyed Provider SDK

T+8500ms Task completion published            NATS
Audit record generated Audit Service

T+8600ms Consumer confirms receipt Consumer SDK
Escrow released ($0.30 → provider)   Settlement
Mesh fee: $0.03                      Settlement

T+∞      Consumer submete rating (4.8)         Consumer SDK
Trust score updated Trust Engine
```

---

## Document Status

```
┌──────────────────────────────────────────────┐
│                                              │
│  Agent Mesh Protocol Specification           │
│  Version: 0.1.0-draft                        │
│  Status: DRAFT — RFC                         │
│                                              │
│ Complete sections: │
│ ✅ 1. Overview │
│ ✅ 2. Design Principles │
│ ✅ 3. Architecture │
│ ✅ 4. Identity and Authentication │
│    ✅ 5. Agent Card Specification            │
│    ✅ 6. Context Contract Specification      │
│ ✅ 7. Message Protocol │
│    ✅ 8. Matching Engine                     │
│    ✅ 9. Data Plane                          │
│ ✅ 10. Governance │
│ ✅ 11. Economic System │
│ ✅ 12. Observability and Audit Trail │
│    ✅ 13. SDK Specification                  │
│ ✅ 14. Deployment and Operation │
│ ✅ 15. Security │
│    ✅ 16. Roadmap                            │
│ ✅ 17. Glossary │
│ ✅ 18. Appendices │
│                                              │
│ Next steps: │
│ □ Technical peer review │
│ □ Implementation of Phase 0 │
│ □ Validation with early adopters │
│ □ Publication as open RFC │
│                                              │
└──────────────────────────────────────────────┘
```
