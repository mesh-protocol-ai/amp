/**
 * Agent Math Expert — Provider on mesh (OpenAI)
 * Registers capability "calculator" in domain demo.math.
 * When receiving a match, listens for the question em mesh.tasks.<sessionId>,
 * solves with the LLM and publishes the result em mesh.results.<sessionId>.
 *
 * Prerequisite: OPENAI_API_KEY, AMP stack running (docker compose up -d).
 */

import { connect } from "nats";
import { Agent, InMemory } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient } from "@meshprotocol/sdk";
import agentCardJson from "./agent-card.json" with { type: "json" };

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8080";

const TASK_SUBJECT_PREFIX = "mesh.tasks.";
const RESULT_SUBJECT_PREFIX = "mesh.results.";
const TASK_TIMEOUT_MS = 30_000;

if (!process.env.OPENAI_API_KEY) {
  console.error("[MathExpert] OPENAI_API_KEY is required.");
  process.exit(1);
}

async function main() {
  console.log("[MathExpert] Starting math provider (OpenAI)...\n");

  const natsForTasks = await connect({ servers: NATS_URL });

  const mesh = new MeshClient({
    natsUrl: NATS_URL,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
    region: "global",
  });

  const model = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  });

  const agent = new Agent({
    id: "math-expert",
    name: "MathExpert",
    model,
    memory: new InMemory(),
    instructions: `You are a math specialist. Your only job is to answer calculation and numeric expression questions.
Reply ONLY with the numeric result or simplified expression, without long explanations.
Examples: "what is 2+2?" -> "4". "What is 15 * 3?" -> "45".`,
  });

  console.log("[MathExpert] Registering on mesh...");
  const reg = await mesh.register(agentCardJson);
  console.log("[MathExpert] Registered:", reg.id, reg.status);
  console.log("[MathExpert] Listening for matches (Ctrl+C to exit)...\n");
  await mesh.startHeartbeat(30_000);

  await mesh.listen(async (match) => {
    const sessionId = match.sessionId;
    const taskSubject = TASK_SUBJECT_PREFIX + sessionId;
    const resultSubject = RESULT_SUBJECT_PREFIX + sessionId;

    console.log("[MathExpert] Match received, sessionId:", sessionId, "- waiting for question on", taskSubject);

    const taskPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error("Timeout waiting for question"));
      }, TASK_TIMEOUT_MS);

      const sub = natsForTasks.subscribe(taskSubject, {
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
            resolve(data.description ?? data.question ?? "");
          } catch {
            resolve("");
          }
        },
      });
    });

    let question = "";
    try {
      question = await taskPromise;
    } catch (e) {
      console.error("[MathExpert] Error receiving task:", e.message);
      return;
    }

    if (!question.trim()) {
      console.log("[MathExpert] Empty question, ignoring.");
      return;
    }

    console.log("[MathExpert] Question received:", question);

    try {
      await agent.addMessage({ role: "user", content: question });
      const result = await agent.execute();
      const answer = (result.content && typeof result.content === "string")
        ? result.content.trim()
        : "(no response)";
      console.log("[MathExpert] Response:", answer);

      const payload = JSON.stringify({ result: answer });
      natsForTasks.publish(resultSubject, new TextEncoder().encode(payload));
    } catch (err) {
      console.error("[MathExpert] Error executing:", err.message);
      const payload = JSON.stringify({ result: "", error: err.message });
      natsForTasks.publish(resultSubject, new TextEncoder().encode(payload));
    }
    console.log("");
  });

  process.on("SIGINT", async () => {
    console.log("\n[MathExpert] Shutting down...");
    await natsForTasks.close();
    await mesh.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[MathExpert] Failure:", err);
  process.exit(1);
});
