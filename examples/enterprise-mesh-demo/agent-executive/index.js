/**
 * Agent Executive — Consumer that queries HR, Finance and Legal in parallel.
 *
 * Demonstrates the core AMP value: a single consumer dispatching requests
 * to multiple specialized department agents simultaneously via the mesh,
 * without knowing anything about their internal systems.
 *
 * Modes:
 *   node index.js                          → full company status report
 *   node index.js "how many employees?"    → routes only to HR
 *   node index.js "q1 budget variance"     → routes only to Finance
 *   node index.js "compliance status"      → routes only to Legal
 *   node index.js "give me everything"     → queries all three in parallel
 *
 * No API key required.
 * Prerequisite: AMP stack + all 3 department agents running.
 */

import { connect } from "nats";
import { MeshClient } from "@meshprotocol/sdk";

const NATS_URL     = process.env.NATS_URL     ?? "nats://localhost:4222";
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8080";
const CONSUMER_DID = "did:mesh:agent:company-executive";

const TASK_PREFIX   = "mesh.tasks.";
const RESULT_PREFIX = "mesh.results.";
const REQUEST_TIMEOUT_MS = 25_000;
const RESULT_TIMEOUT_MS  = 15_000;

// ── Department routing ────────────────────────────────────────────────────────
const DEPARTMENTS = {
  hr: {
    domain:       ["company", "hr"],
    capabilityId: "hr-query",
    label:        "HR",
  },
  finance: {
    domain:       ["company", "finance"],
    capabilityId: "finance-query",
    label:        "Finance",
  },
  legal: {
    domain:       ["company", "legal"],
    capabilityId: "legal-query",
    label:        "Legal",
  },
};

function detectDepartments(question) {
  const q = question.toLowerCase();
  const targets = [];

  const hrPatterns      = /hr|headcount|employee|staff|people|team|vacancy|vacanc|hiring|vacation|pto|turnover|rh|funcionário|vaga/;
  const financePatterns = /financ|budget|variance|q1|cash|flow|orçamento|custo|spend|revenue|caixa/;
  const legalPatterns   = /legal|contract|compliance|lgpd|gdpr|privacy|liability|pending|contrato|jurídico/;
  const allPatterns     = /everything|all|status|report|overview|completo|tudo|geral/;

  if (allPatterns.test(q)) return ["hr", "finance", "legal"];

  if (hrPatterns.test(q))      targets.push("hr");
  if (financePatterns.test(q)) targets.push("finance");
  if (legalPatterns.test(q))   targets.push("legal");

  // Default: query all three
  return targets.length > 0 ? targets : ["hr", "finance", "legal"];
}

// ── Single department query ───────────────────────────────────────────────────
async function queryDepartment(mesh, nats, deptKey, question) {
  const dept = DEPARTMENTS[deptKey];

  console.log(`[Executive] → Requesting ${dept.label} specialist on mesh...`);

  const result = await mesh.request({
    domain:       dept.domain,
    capabilityId: dept.capabilityId,
    description:  question,
    timeoutMs:    REQUEST_TIMEOUT_MS,
  });

  if (result.kind === "reject") {
    return { dept: dept.label, success: false, error: result.reason };
  }

  const { sessionId } = result;
  const taskSubject   = TASK_PREFIX   + sessionId;
  const resultSubject = RESULT_PREFIX + sessionId;

  console.log(`[Executive] ✓ Matched ${dept.label} — sessionId: ${sessionId}`);

  // Brief pause to ensure the provider is subscribed before we publish the task
  await new Promise(r => setTimeout(r, 300));

  // Publish the task
  nats.publish(
    taskSubject,
    new TextEncoder().encode(JSON.stringify({ description: question }))
  );

  // Wait for the result
  const answer = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`Timeout waiting for ${dept.label} response`));
    }, RESULT_TIMEOUT_MS);

    const sub = nats.subscribe(resultSubject, {
      max: 1,
      callback: (err, msg) => {
        clearTimeout(timeout);
        sub.unsubscribe();
        if (err) { reject(err); return; }
        try {
          const data = JSON.parse(new TextDecoder().decode(msg.data));
          resolve(data.result ?? data.error ?? "(no response)");
        } catch {
          resolve("(invalid response)");
        }
      },
    });
  });

  return { dept: dept.label, success: true, answer };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const question = process.argv.slice(2).join(" ") || "Give me a complete company status report.";

  console.log("┌─────────────────────────────────────────────┐");
  console.log("│        AMP — Enterprise Mesh Demo           │");
  console.log("│  Multi-department parallel query            │");
  console.log("└─────────────────────────────────────────────┘");
  console.log(`\n[Executive] Question: "${question}"\n`);

  const targets = detectDepartments(question);
  console.log(`[Executive] Routing to: ${targets.map(t => DEPARTMENTS[t].label).join(", ")}\n`);

  const nats = await connect({ servers: NATS_URL });
  const mesh = new MeshClient({
    natsUrl:     NATS_URL,
    registryUrl: REGISTRY_URL,
    did:         CONSUMER_DID,
  });

  // ── Fire all department queries IN PARALLEL ───────────────────────────────
  const startTime = Date.now();

  const results = await Promise.allSettled(
    targets.map(deptKey => queryDepartment(mesh, nats, deptKey, question))
  );

  const elapsed = Date.now() - startTime;

  // ── Print consolidated report ─────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  COMPANY STATUS REPORT");
  console.log("  Queried " + targets.length + " department(s) in parallel — " + elapsed + "ms");
  console.log("═".repeat(60));

  for (const settled of results) {
    if (settled.status === "fulfilled") {
      const { dept, success, answer, error } = settled.value;
      console.log(`\n▸ ${dept}`);
      console.log("  " + (success ? answer : `ERROR: ${error}`).replace(/\n/g, "\n  "));
    } else {
      console.log(`\n▸ ERROR: ${settled.reason?.message}`);
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log(`  Done in ${elapsed}ms.`);
  console.log("═".repeat(60) + "\n");

  await nats.close();
  await mesh.close();
}

main().catch(err => {
  console.error("[Executive] Fatal error:", err);
  process.exit(1);
});
