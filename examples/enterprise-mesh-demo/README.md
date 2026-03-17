# Enterprise Mesh Demo — Multi-department parallel query

This demo shows AMP in an **intra-company** scenario: specialized agents per department (HR, Finance, Legal) connected to a central AMP broker. A consumer (`agent-executive`) dispatches requests to multiple departments **in parallel** without knowing anything about their internal systems.

> No API key required. Department agents use mock data. The AMP stack is the only prerequisite.

---

## The concept

```
                        ┌─────────────────────────────────────┐
                        │         AMP Broker (NATS)           │
                        │   Registry · Matching · Control     │
                        └──────────┬───────────┬──────────────┘
                                   │ match      │ match
              ┌────────────────────┘           └────────────────────┐
              │                                                      │
    ┌─────────▼──────────┐                           ┌──────────────▼──────┐
    │   agent-executive  │ ──── mesh.request ──────► │  agent-hr           │
    │   (Consumer)       │                           │  domain: company.hr │
    │                    │ ──── mesh.request ──────► │  agent-finance      │
    │  No knowledge of   │      (in parallel)        │  domain: company.finance
    │  internal systems  │ ──── mesh.request ──────► │  agent-legal        │
    └────────────────────┘                           │  domain: company.legal
                                                     └─────────────────────┘
```

Each department agent:
- Registers its **Agent Card** (domain + capability) on startup
- Listens for matches via NATS
- Processes the question with its specialized knowledge base
- Returns the result — **the executive never sees the internal data model**

---

## Demos

| Command | What happens |
|---------|-------------|
| `npm run run:executive:all` | Queries all 3 departments in parallel → full company report |
| `npm run run:executive:headcount` | Routes to HR only |
| `npm run run:executive:budget` | Routes to Finance only |
| `npm run run:executive:compliance` | Routes to Legal only |
| `npm run run:executive` | Custom question via `-- "your question"` |

### Routing logic

The executive detects keywords and routes accordingly:

| Keywords | Department |
|----------|-----------|
| headcount, employee, staff, team, vacancy, hiring, vacation, turnover | HR |
| budget, variance, q1, cash, flow, spend, cost | Finance |
| contract, compliance, lgpd, gdpr, liability, pending | Legal |
| everything, all, status, report, overview | All three (parallel) |
| *(no match)* | All three (parallel, default) |

---

## Expected output

```
┌─────────────────────────────────────────────┐
│        AMP — Enterprise Mesh Demo           │
│  Multi-department parallel query            │
└─────────────────────────────────────────────┘

[Executive] Question: "Give me a complete company status report."

[Executive] Routing to: HR, Finance, Legal

[Executive] → Requesting HR specialist on mesh...
[Executive] → Requesting Finance specialist on mesh...
[Executive] → Requesting Legal specialist on mesh...
[Executive] ✓ Matched HR      — sessionId: 019cfba2-efcb-756b-9576-e41148d71797
[Executive] ✓ Matched Finance — sessionId: 019cfba2-efce-7927-a8cd-882de50bc115
[Executive] ✓ Matched Legal   — sessionId: 019cfba2-efcf-7bbb-baca-cba88c4166bf

════════════════════════════════════════════════════════════
  COMPANY STATUS REPORT
  Queried 3 department(s) in parallel — 380ms
════════════════════════════════════════════════════════════

▸ HR
  HR Summary — Total: 232 employees (LATAM: 45 | US-East: 120 | Europe: 67) | Open positions: 3 | Turnover: 8.2% in the last 12 months (market benchmark: 12%)

▸ Finance
  Finance Summary — Q1 Actual: $3,980,000 (-5.2% vs plan) | Net cash flow: $640,000 | Runway: 18 months.

▸ Legal
  Legal Summary — Active contracts: 47 (6 expiring in 90 days) | LGPD: Compliant | SOC 2: In progress (by 2025-06-30) | Pending items: 3

════════════════════════════════════════════════════════════
  Done in 380ms.
════════════════════════════════════════════════════════════
```

> Output real, rodado localmente em 17/03/2026.

---

## Data plane note

The official AMP Data Plane (gRPC + E2E encryption) is not yet implemented. This demo uses NATS directly for task/result exchange — the same approach as `nebula-mesh-demo`:

| Subject | Direction | Payload |
|---------|-----------|---------|
| `mesh.tasks.<sessionId>` | Executive → Department | `{ "description": "<question>" }` |
| `mesh.results.<sessionId>` | Department → Executive | `{ "result": "<answer>" }` |

---

## How to run

### 1. Start the AMP stack

```bash
# From the repository root:
docker compose up -d
```

### 2. Install dependencies

```bash
cd examples/enterprise-mesh-demo
npm run install:all
```

### 3. Start department agents (each in a separate terminal)

```bash
# Terminal 1
npm run run:hr

# Terminal 2
npm run run:finance

# Terminal 3
npm run run:legal
```

### 4. Run the executive (Terminal 4)

```bash
# Full company report (queries all 3 departments in parallel):
npm run run:executive:all

# Or ask anything:
node agent-executive/index.js "How many open positions do we have and what is the Q1 budget variance?"
```

---

## Repository structure

```
enterprise-mesh-demo/
├── package.json              # Root scripts
├── README.md
├── agent-hr/
│   ├── agent-card.json       # Agent Card: domain company.hr, capability hr-query
│   ├── index.js              # HR specialist (mock data)
│   └── package.json
├── agent-finance/
│   ├── agent-card.json       # Agent Card: domain company.finance, capability finance-query
│   ├── index.js              # Finance specialist (mock data)
│   └── package.json
├── agent-legal/
│   ├── agent-card.json       # Agent Card: domain company.legal, capability legal-query
│   ├── index.js              # Legal specialist (mock data)
│   └── package.json
└── agent-executive/
    ├── index.js              # Consumer: parallel multi-department queries
    └── package.json
```

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| `no_providers_available` for HR | Is `agent-hr` running and registered? `curl http://localhost:8080/agents?domain=company,hr` |
| `no_providers_available` for Finance | Is `agent-finance` running? `curl http://localhost:8080/agents?domain=company,finance` |
| `no_providers_available` for Legal | Is `agent-legal` running? `curl http://localhost:8080/agents?domain=company,legal` |
| Timeout on result | Did you start the department agents before the executive? |
| Stack not running | `docker compose ps` — all services must be `Up` |
