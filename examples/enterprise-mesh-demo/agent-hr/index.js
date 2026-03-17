/**
 * Agent HR — Provider specialist in Human Resources
 * Domain: company.hr | Capability: hr-query
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

// ── Mock HR knowledge base ────────────────────────────────────────────────────
const HR = {
  headcount: {
    total: 232,
    by_region: { LATAM: 45, "US-East": 120, Europe: 67 },
    by_dept:   { Engineering: 98, Sales: 54, Operations: 42, Legal: 18, Finance: 20 },
  },
  open_positions: [
    { role: "Senior Backend Engineer", dept: "Engineering", region: "LATAM"   },
    { role: "Account Executive",       dept: "Sales",       region: "US-East" },
    { role: "Data Analyst",            dept: "Operations",  region: "Europe"  },
  ],
  vacation_policy: "30 days/year. Carries over up to 60 days. Approval required 15 days in advance.",
  turnover_rate:   "8.2% in the last 12 months (market benchmark: 12%)",
};

function answer(question) {
  const q = question.toLowerCase();

  if (/headcount|team|people|employee|staff|quantos/.test(q)) {
    const { total, by_region, by_dept } = HR.headcount;
    return (
      `Headcount: ${total} employees.\n` +
      `By region — LATAM: ${by_region.LATAM}, US-East: ${by_region["US-East"]}, Europe: ${by_region.Europe}.\n` +
      `By dept — Engineering: ${by_dept.Engineering}, Sales: ${by_dept.Sales}, Operations: ${by_dept.Operations}, ` +
      `Legal: ${by_dept.Legal}, Finance: ${by_dept.Finance}.`
    );
  }

  if (/open|position|vacanc|hiring|recruit|vaga/.test(q)) {
    const list = HR.open_positions.map(p => `${p.role} (${p.dept}, ${p.region})`).join("; ");
    return `${HR.open_positions.length} open positions: ${list}.`;
  }

  if (/vacation|pto|leave|férias|licença/.test(q)) {
    return `Vacation policy: ${HR.vacation_policy}`;
  }

  if (/turnover|attrition|churn|rotatividade/.test(q)) {
    return `Turnover rate: ${HR.turnover_rate}`;
  }

  // Default: full summary
  const { total, by_region } = HR.headcount;
  return (
    `HR Summary — Total: ${total} employees ` +
    `(LATAM: ${by_region.LATAM} | US-East: ${by_region["US-East"]} | Europe: ${by_region.Europe}) | ` +
    `Open positions: ${HR.open_positions.length} | ` +
    `Turnover: ${HR.turnover_rate}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[HR Agent] Starting HR specialist...\n");

  const nats = await connect({ servers: NATS_URL });
  const mesh = new MeshClient({
    natsUrl: NATS_URL,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
  });

  const reg = await mesh.register(agentCardJson);
  console.log("[HR Agent] Registered:", reg.id, "|", reg.status);
  console.log("[HR Agent] Listening for requests (Ctrl+C to exit)...\n");

  await mesh.listen(async (match) => {
    const { sessionId } = match;
    const taskSubject   = TASK_PREFIX   + sessionId;
    const resultSubject = RESULT_PREFIX + sessionId;
    console.log("[HR Agent] Match — sessionId:", sessionId);

    // Wait for the question from the consumer
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
      console.log("[HR Agent] Empty question, ignoring.");
      return;
    }

    console.log("[HR Agent] Question:", question);
    const response = answer(question);
    console.log("[HR Agent] Response:", response, "\n");

    nats.publish(
      resultSubject,
      new TextEncoder().encode(JSON.stringify({ result: response }))
    );
  });

  process.on("SIGINT", async () => {
    console.log("\n[HR Agent] Shutting down...");
    await nats.close();
    await mesh.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error("[HR Agent] Fatal error:", err);
  process.exit(1);
});
