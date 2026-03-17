/**
 * Agent Legal — Provider specialist in Legal & Compliance
 * Domain: company.legal | Capability: legal-query
 *
 * Responds with mock data — no API key required.
 * Prerequisite: AMP stack running (docker compose up -d in repo root).
 */

import { connect } from "nats";
import { MeshClient } from "@meshprotocol/sdk";
import agentCardJson from "./agent-card.json" with { type: "json" };

const NATS_URL      = process.env.NATS_URL      ?? "nats://localhost:4222";
const REGISTRY_URL  = process.env.REGISTRY_URL  ?? "http://localhost:8080";
const TASK_PREFIX   = "mesh.tasks.";
const RESULT_PREFIX = "mesh.results.";
const TASK_TIMEOUT_MS = 30_000;

// ── Mock Legal knowledge base ─────────────────────────────────────────────────
const LEGAL = {
  contracts: {
    total_active: 47,
    expiring_90_days: 6,
    by_type: {
      "SaaS / Vendor":    18,
      "Customer (MSA)":   15,
      "NDA":               9,
      "Employment":         5,
    },
    high_value: [
      { counterpart: "AWS",          value_usd: 480_000, expires: "2025-12-31" },
      { counterpart: "Salesforce",   value_usd: 120_000, expires: "2025-09-30" },
      { counterpart: "Client A",     value_usd: 320_000, expires: "2026-03-15" },
    ],
  },
  compliance: {
    lgpd: {
      status: "Compliant",
      dpo_assigned: true,
      last_audit: "2024-11-10",
      open_incidents: 0,
    },
    soc2: {
      status: "In progress",
      type: "Type II",
      expected_cert: "2025-06-30",
      auditor: "Deloitte",
    },
    iso27001: {
      status: "Planned",
      expected_start: "2025-Q3",
    },
  },
  pending_items: [
    { type: "Contract renewal",  counterpart: "Salesforce", deadline: "2025-06-30", priority: "High"   },
    { type: "NDA review",        counterpart: "Partner B",  deadline: "2025-04-15", priority: "Medium" },
    { type: "SOC 2 evidence",    counterpart: "Deloitte",   deadline: "2025-05-01", priority: "High"   },
  ],
};

function answer(question) {
  const q = question.toLowerCase();

  if (/contract|agreement|contrato/.test(q)) {
    const { total_active, expiring_90_days, by_type } = LEGAL.contracts;
    const types = Object.entries(by_type).map(([k, v]) => `${k}: ${v}`).join(", ");
    return (
      `Active contracts: ${total_active} | Expiring in 90 days: ${expiring_90_days}.\n` +
      `By type — ${types}.`
    );
  }

  if (/lgpd|gdpr|privacy|compliance|privacidade/.test(q)) {
    const { lgpd, soc2 } = LEGAL.compliance;
    return (
      `LGPD: ${lgpd.status} (DPO assigned: ${lgpd.dpo_assigned ? "yes" : "no"}, ` +
      `last audit: ${lgpd.last_audit}, open incidents: ${lgpd.open_incidents}).\n` +
      `SOC 2 Type II: ${soc2.status} — expected certification by ${soc2.expected_cert} (auditor: ${soc2.auditor}).`
    );
  }

  if (/pending|due|deadline|risk|liability|vencimento/.test(q)) {
    const items = LEGAL.pending_items
      .map(i => `[${i.priority}] ${i.type} — ${i.counterpart} (due ${i.deadline})`)
      .join("; ");
    return `Pending legal items: ${items}.`;
  }

  if (/high.value|biggest|largest|maior/.test(q)) {
    const list = LEGAL.contracts.high_value
      .map(c => `${c.counterpart}: $${(c.value_usd / 1000).toFixed(0)}k (exp. ${c.expires})`)
      .join(", ");
    return `High-value contracts: ${list}.`;
  }

  // Default: full summary
  const { total_active, expiring_90_days } = LEGAL.contracts;
  const { lgpd, soc2 } = LEGAL.compliance;
  return (
    `Legal Summary — Active contracts: ${total_active} (${expiring_90_days} expiring in 90 days) | ` +
    `LGPD: ${lgpd.status} | SOC 2: ${soc2.status} (by ${soc2.expected_cert}) | ` +
    `Pending items: ${LEGAL.pending_items.length}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[Legal Agent] Starting Legal specialist...\n");

  const nats = await connect({ servers: NATS_URL });
  const mesh = new MeshClient({
    natsUrl: NATS_URL,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
  });

  const reg = await mesh.register(agentCardJson);
  console.log("[Legal Agent] Registered:", reg.id, "|", reg.status);
  console.log("[Legal Agent] Listening for requests (Ctrl+C to exit)...\n");

  await mesh.listen(async (match) => {
    const { sessionId } = match;
    const taskSubject   = TASK_PREFIX   + sessionId;
    const resultSubject = RESULT_PREFIX + sessionId;
    console.log("[Legal Agent] Match — sessionId:", sessionId);

    const question = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error("Timeout waiting for task"));
      }, TASK_TIMEOUT_MS);

      const sub = nats.subscribe(taskSubject, {
        max: 1,
        callback: (err, msg) => {
          clearTimeout(timeout);
          sub.unsubscribe();
          if (err) { reject(err); return; }
          try {
            const data = JSON.parse(new TextDecoder().decode(msg.data));
            resolve(data.description ?? data.question ?? "");
          } catch { resolve(""); }
        },
      });
    });

    if (!question.trim()) {
      console.log("[Legal Agent] Empty question, ignoring.");
      return;
    }

    console.log("[Legal Agent] Question:", question);
    const response = answer(question);
    console.log("[Legal Agent] Response:", response, "\n");

    nats.publish(
      resultSubject,
      new TextEncoder().encode(JSON.stringify({ result: response }))
    );
  });

  process.on("SIGINT", async () => {
    console.log("\n[Legal Agent] Shutting down...");
    await nats.close();
    await mesh.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error("[Legal Agent] Fatal error:", err);
  process.exit(1);
});
