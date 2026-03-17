/**
 * Agent Finance — Provider specialist in Finance
 * Domain: company.finance | Capability: finance-query
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

// ── Mock Finance knowledge base ───────────────────────────────────────────────
const FINANCE = {
  q1_budget: {
    planned_total_usd: 4_200_000,
    actual_total_usd:  3_980_000,
    variance_pct:      -5.2, // negative = under budget (favorable)
    by_dept: {
      Engineering: { planned: 1_800_000, actual: 1_720_000, variance_pct: -4.4 },
      Sales:       { planned:   900_000, actual:   950_000, variance_pct: +5.6 },
      Operations:  { planned:   750_000, actual:   680_000, variance_pct: -9.3 },
      Legal:       { planned:   400_000, actual:   390_000, variance_pct: -2.5 },
      Finance:     { planned:   350_000, actual:   240_000, variance_pct: -31.4 },
    },
  },
  cash_flow: {
    operating_usd:   1_250_000,
    investing_usd:    -430_000,
    financing_usd:    -180_000,
    net_usd:           640_000,
    runway_months:        18,
  },
  cost_centers: [
    { id: "CC-001", name: "Engineering — Product",  spend_usd: 920_000 },
    { id: "CC-002", name: "Engineering — Platform", spend_usd: 800_000 },
    { id: "CC-003", name: "Sales — LATAM",           spend_usd: 420_000 },
    { id: "CC-004", name: "Sales — US-East",         spend_usd: 530_000 },
  ],
};

function fmt(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function answer(question) {
  const q = question.toLowerCase();

  if (/budget|variance|q1|orçamento|variação/.test(q)) {
    const { planned_total_usd, actual_total_usd, variance_pct, by_dept } = FINANCE.q1_budget;
    const sign = variance_pct < 0 ? "under budget ✓" : "over budget ⚠";
    let breakdown = Object.entries(by_dept)
      .map(([dept, d]) => `${dept}: ${fmt(d.actual)} (${d.variance_pct > 0 ? "+" : ""}${d.variance_pct}%)`)
      .join(", ");
    return (
      `Q1 Budget — Planned: ${fmt(planned_total_usd)} | Actual: ${fmt(actual_total_usd)} | ` +
      `Variance: ${variance_pct}% (${sign}).\nBy dept: ${breakdown}.`
    );
  }

  if (/cash|flow|caixa|runway/.test(q)) {
    const { operating_usd, investing_usd, financing_usd, net_usd, runway_months } = FINANCE.cash_flow;
    return (
      `Cash Flow — Operating: ${fmt(operating_usd)} | Investing: ${fmt(investing_usd)} | ` +
      `Financing: ${fmt(financing_usd)} | Net: ${fmt(net_usd)} | Runway: ${runway_months} months.`
    );
  }

  if (/cost.center|centro.custo/.test(q)) {
    const list = FINANCE.cost_centers.map(c => `${c.name}: ${fmt(c.spend_usd)}`).join("; ");
    return `Top cost centers: ${list}.`;
  }

  // Default: summary
  const { actual_total_usd, variance_pct } = FINANCE.q1_budget;
  const { net_usd, runway_months } = FINANCE.cash_flow;
  return (
    `Finance Summary — Q1 Actual: ${fmt(actual_total_usd)} (${variance_pct}% vs plan) | ` +
    `Net cash flow: ${fmt(net_usd)} | Runway: ${runway_months} months.`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[Finance Agent] Starting Finance specialist...\n");

  const nats = await connect({ servers: NATS_URL });
  const mesh = new MeshClient({
    natsUrl: NATS_URL,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
  });

  const reg = await mesh.register(agentCardJson);
  console.log("[Finance Agent] Registered:", reg.id, "|", reg.status);
  console.log("[Finance Agent] Listening for requests (Ctrl+C to exit)...\n");

  await mesh.listen(async (match) => {
    const { sessionId } = match;
    const taskSubject   = TASK_PREFIX   + sessionId;
    const resultSubject = RESULT_PREFIX + sessionId;
    console.log("[Finance Agent] Match — sessionId:", sessionId);

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
      console.log("[Finance Agent] Empty question, ignoring.");
      return;
    }

    console.log("[Finance Agent] Question:", question);
    const response = answer(question);
    console.log("[Finance Agent] Response:", response, "\n");

    nats.publish(
      resultSubject,
      new TextEncoder().encode(JSON.stringify({ result: response }))
    );
  });

  process.on("SIGINT", async () => {
    console.log("\n[Finance Agent] Shutting down...");
    await nats.close();
    await mesh.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error("[Finance Agent] Fatal error:", err);
  process.exit(1);
});
