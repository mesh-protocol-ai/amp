/**
 * Agent Consumer — NebulaOS + Mesh
 * Uses a NebulaOS Agent and the mesh SDK to request capabilities from a provider.
 * Simulates interaction: request -> match -> result log.
 *
 * Prerequisite: stack running and provider already registered (run agent-provider first).
 * NATS_URL e REGISTRY_URL via env ou default localhost.
 */

import { Agent, InMemory } from "@nebulaos/core";
import { MeshClient } from "@meshprotocol/sdk";
import { createMockModel } from "./mock-model.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8080";
const CONSUMER_DID = "did:mesh:agent:nebula-orchestrator";

async function main() {
  console.log("[Consumer] Starting NebulaOS + Mesh agent...\n");

  const mesh = new MeshClient({
    natsUrl: NATS_URL,
    registryUrl: REGISTRY_URL,
    did: CONSUMER_DID,
    region: "global",
  });

  const agent = new Agent({
    id: "nebula-orchestrator",
    name: "NebulaOrchestrator",
    model: createMockModel("mock", "demo"),
    memory: new InMemory(),
    instructions: "You orchestrate tasks on the mesh. When the user asks, request capability assistant in the demo/nebula domain.",
  });

  console.log("[Consumer] Requesting capability assistant on mesh (domain: demo.nebula)...");
  console.log("[Consumer] If timeout happens, check: docker compose ps (amp-matching must be Up) and that provider already registered.\n");

  let result;
  try {
    result = await mesh.request({
      domain: ["demo", "nebula"],
      capabilityId: "assistant",
      description: "Request from NebulaOS consumer agent",
      timeoutMs: 25_000,
    });
  } catch (err) {
    if (err.message?.includes("timeout")) {
      console.error("[Consumer] Timeout: Matching did not respond. Check:");
      console.error("  1. docker compose ps → amp-matching deve estar Up");
      console.error("  2. Provider running in another terminal (npm run run:provider)");
      console.error("  3. NATS reachable at", NATS_URL);
    }
    throw err;
  }

  if (result.kind === "match") {
    console.log("[Consumer] Match received!");
    console.log("  requestId:", result.requestId);
    console.log("  sessionId:", result.sessionId);
    console.log("  provider:", result.parties.provider);
    console.log("  consumer:", result.parties.consumer);

    await agent.addMessage({
      role: "user",
      content: `Match received with provider ${result.parties.provider}. Session: ${result.sessionId}. (Data plane is not implemented in this demo - full interaction in a future version.)`,
    });
    const exec = await agent.execute();
    console.log("\n[Consumer] NebulaOS agent response:", exec.content ?? "(vazio)");
  } else {
    console.log("[Consumer] Reject:", result.reason);
    await agent.addMessage({
      role: "user",
      content: `Mesh rejected: ${result.reason}`,
    });
    await agent.execute();
  }

  await mesh.close();
  console.log("\n[Consumer] Finished.");
}

main().catch((err) => {
  console.error("[Consumer] Failure:", err);
  process.exit(1);
});
