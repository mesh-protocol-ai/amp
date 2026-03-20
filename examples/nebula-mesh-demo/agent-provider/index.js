/**
 * Agent Provider — NebulaOS + Mesh
 * Registers the agent on mesh and listens for matches. When a match arrives, simulates execution with the Agent.
 *
 * Prerequisite: stack running (docker compose up -d) at repo root.
 * NATS_URL and REGISTRY_URL via env or default localhost.
 */

import { Agent, InMemory } from "@nebulaos/core";
import { MeshClient } from "@meshprotocol/sdk";
import { createMockModel } from "./mock-model.js";
import agentCardJson from "./agent-card.json" with { type: "json" };

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8080";

async function main() {
  console.log("[Provider] Starting NebulaOS + Mesh agent...\n");

  const mesh = new MeshClient({
    natsUrl: NATS_URL,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
    region: "global",
  });

  const agent = new Agent({
    id: "nebula-echo-provider",
    name: "NebulaEchoProvider",
    model: createMockModel("mock", "demo"),
    memory: new InMemory(),
    instructions: "You are an agent on the mesh. Respond briefly and helpfully.",
  });

  console.log("[Provider] Registering Agent Card on mesh...");
  const reg = await mesh.register(agentCardJson);
  console.log("[Provider] Registered:", reg.id, reg.status);
  await mesh.startHeartbeat(30_000);

  console.log("[Provider] Listening for matches (Ctrl+C to exit)...\n");

  await mesh.listen(async (match) => {
    console.log("[Provider] Match received!");
    console.log("  sessionId:", match.sessionId);
    console.log("  consumer:", match.parties.consumer);
    console.log("  provider:", match.parties.provider);

    try {
      await agent.addMessage({
        role: "user",
        content: `Request via mesh — session ${match.sessionId}`,
      });
      const result = await agent.execute();
      console.log("[Provider] NebulaOS agent response:", result.content ?? "(empty)");
    } catch (err) {
      console.error("[Provider] Error executing agent:", err.message);
    }
    console.log("");
  });

  process.on("SIGINT", async () => {
    console.log("\n[Provider] Shutting down...");
    await mesh.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[Provider] Failure:", err);
  process.exit(1);
});
