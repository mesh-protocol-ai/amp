/**
 * Dumb consumer — connects to PUBLIC mesh (meshprotocol.dev).
 * Asks one math question; uses tool to request from mesh specialist, returns answer via OpenAI.
 * Loads .env from parent (NATS_TOKEN, REGISTRY_URL, OPENAI_API_KEY).
 */

import { connect } from "nats";
import { Agent, InMemory, Tool } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient } from "@meshprotocol/sdk";
import { z } from "zod";

const DEFAULT_HOST = "nats.meshprotocol.dev";
const DEFAULT_PORT = "4222";

function getNatsServerUrl() {
  const raw = (process.env.NATS_URL || "").trim();
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  if (raw.startsWith("nats://")) {
    try {
      const u = new URL(raw);
      if (u.hostname && u.hostname.includes(".")) {
        host = u.hostname;
        port = u.port || DEFAULT_PORT;
      }
      return `nats://${host}:${port}`;
    } catch (_) {}
  }
  if (raw.includes(".")) {
    const [h, p] = raw.split(":");
    if (h) host = h;
    if (p && /^\d+$/.test(p)) port = p;
  }
  return `nats://${host}:${port}`;
}

const NATS_SERVER = getNatsServerUrl();
const NATS_TOKEN = (process.env.NATS_TOKEN || "").trim();
const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.meshprotocol.dev";
const CONSUMER_DID = "did:mesh:agent:public-demo-consumer";
const TASK_PREFIX = "mesh.tasks.";
const RESULT_PREFIX = "mesh.results.";
const REQUEST_TIMEOUT_MS = 25_000;
const RESULT_TIMEOUT_MS = 15_000;

if (!process.env.OPENAI_API_KEY) {
  console.error("[Consumer] OPENAI_API_KEY is required (set in .env).");
  process.exit(1);
}
if (!process.env.NATS_TOKEN) {
  console.error("[Consumer] NATS_TOKEN is required for public mesh (set in .env).");
  process.exit(1);
}

async function main() {
  console.log("[Consumer] Connecting to PUBLIC mesh (meshprotocol.dev)...\n");

  const natsForTasks = await connect({
    servers: NATS_SERVER,
    token: NATS_TOKEN || undefined,
  });

  const mesh = new MeshClient({
    natsUrl: NATS_SERVER,
    registryUrl: REGISTRY_URL,
    did: CONSUMER_DID,
    region: "global",
    natsAuth: NATS_TOKEN ? { token: NATS_TOKEN } : undefined,
  });

  const requestMathFromMeshTool = new Tool({
    id: "request_math_from_mesh",
    description: "Sends a math/calculation question to a specialist on the mesh. Use this when the user asks for any math operation.",
    inputSchema: z.object({
      question: z.string().describe("The math question or expression"),
    }),
    handler: async (_ctx, { question }) => {
      const result = await mesh.request({
        domain: ["demo", "math"],
        capabilityId: "calculator",
        description: question,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      if (result.kind === "reject") {
        return { success: false, error: result.reason, result: null };
      }

      const sessionId = result.sessionId;
      const taskSubject = TASK_PREFIX + sessionId;
      const resultSubject = RESULT_PREFIX + sessionId;

      await new Promise((r) => setTimeout(r, 300));

      natsForTasks.publish(
        taskSubject,
        new TextEncoder().encode(JSON.stringify({ description: question }))
      );

      const answer = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          sub.unsubscribe();
          reject(new Error("Timeout waiting for specialist response"));
        }, RESULT_TIMEOUT_MS);

        const sub = natsForTasks.subscribe(resultSubject, {
          max: 1,
          callback: (err, msg) => {
            clearTimeout(timeout);
            sub.unsubscribe();
            if (err) {
              reject(err);
              return;
            }
            try {
              const data = JSON.parse(new TextDecoder().decode(msg.data));
              resolve(data.result ?? data.error ?? "(no response)");
            } catch {
              resolve("(invalid response)");
            }
          },
        });
      });

      return { success: true, result: answer };
    },
  });

  const model = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5-nano",
  });

  const agent = new Agent({
    id: "public-demo-consumer",
    name: "PublicDemoConsumer",
    model,
    memory: new InMemory(),
    instructions: `You cannot do math. For any numeric or calculation question, use request_math_from_mesh with the user question, then answer with the returned result. Do not invent numbers.`,
    tools: [requestMathFromMeshTool],
  });

  const question = process.argv.slice(2).join(" ") || "What is 2 + 2?";

  console.log("[Consumer] Question:", question);
  console.log("[Consumer] Requesting via public mesh...\n");

  await agent.addMessage({ role: "user", content: question });
  const exec = await agent.execute();

  console.log("[Consumer] Response:", exec.content ?? "(empty)");

  await natsForTasks.close();
  await mesh.close();
  console.log("\n[Consumer] Done.");
}

main().catch((err) => {
  console.error("[Consumer] Failure:", err);
  process.exit(1);
});
