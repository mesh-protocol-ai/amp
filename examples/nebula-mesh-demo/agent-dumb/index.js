/**
 * Agent Dumb — Consumer on mesh (OpenAI)
 * Agent that "cannot do math": delegates any calculation to the mesh,
 * usando a tool request_math_from_mesh(question).
 *
 * Prerequisite: OPENAI_API_KEY, AMP stack running, and agent-math-expert running.
 */

import { connect } from "nats";
import { Agent, InMemory, Tool } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient } from "@meshprotocol/sdk";
import { z } from "zod";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8080";
const CONSUMER_DID = "did:mesh:agent:agent-dumb";
const TASK_PREFIX = "mesh.tasks.";
const RESULT_PREFIX = "mesh.results.";
const REQUEST_TIMEOUT_MS = 25_000;
const RESULT_TIMEOUT_MS = 15_000;

if (!process.env.OPENAI_API_KEY) {
  console.error("[AgentDumb] OPENAI_API_KEY is required.");
  process.exit(1);
}

async function main() {
  console.log("[AgentDumb] Starting dumb agent (OpenAI)...\n");

  const natsForTasks = await connect({ servers: NATS_URL });

  const mesh = new MeshClient({
    natsUrl: NATS_URL,
    registryUrl: REGISTRY_URL,
    did: CONSUMER_DID,
    region: "global",
  });

  const requestMathFromMeshTool = new Tool({
    id: "request_math_from_mesh",
    description: "Sends a math/calculation question to a specialist on the mesh network. ALWAYS use this when the user asks for any math operation or calculation.",
    inputSchema: z.object({
      question: z.string().describe("The math question or expression (e.g., what is 2+2?, compute 15*3)"),
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
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  });

  const agent = new Agent({
    id: "agent-dumb",
    name: "AgentDumb",
    model,
    memory: new InMemory(),
    instructions: `You are a very limited assistant. You CANNOT do arithmetic or math by yourself.
Whenever the user asks anything numeric (sums, multiplications, expressions, "what is X?", etc.),
you MUST use request_math_from_mesh with the user question, then answer with the returned result.
Do not invent numbers. Use only the tool for calculations.`,
    tools: [requestMathFromMeshTool],
  });

  const question = process.argv.slice(2).join(" ") || "What is 2 + 2?";

  console.log("[AgentDumb] Question:", question);
  console.log("[AgentDumb] Calling agent (it may use the tool to request through mesh)...\n");

  await agent.addMessage({ role: "user", content: question });
  const exec = await agent.execute();

  console.log("[AgentDumb] Response:", exec.content ?? "(vazio)");

  await natsForTasks.close();
  await mesh.close();
  console.log("\n[AgentDumb] Finished.");
}

main().catch((err) => {
  console.error("[AgentDumb] Failure:", err);
  process.exit(1);
});
