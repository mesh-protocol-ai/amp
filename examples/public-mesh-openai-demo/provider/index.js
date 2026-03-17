/**
 * Math Expert provider — connects to PUBLIC mesh (meshprotocol.dev).
 * Registers calculator capability, listens for matches, answers via OpenAI.
 * Loads .env from parent (NATS_TOKEN, REGISTRY_URL, OPENAI_API_KEY).
 */

import { connect } from "nats";
import { Agent, InMemory } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient } from "@meshprotocol/sdk";
import agentCardJson from "./agent-card.json" with { type: "json" };

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
const TASK_SUBJECT_PREFIX = "mesh.tasks.";
const RESULT_SUBJECT_PREFIX = "mesh.results.";
const TASK_TIMEOUT_MS = 30_000;

if (!process.env.OPENAI_API_KEY) {
  console.error("[MathExpert] OPENAI_API_KEY is required (set in .env).");
  process.exit(1);
}
if (!process.env.NATS_TOKEN) {
  console.error("[MathExpert] NATS_TOKEN is required for public mesh (set in .env).");
  process.exit(1);
}

async function main() {
  console.log("[MathExpert] Connecting to PUBLIC mesh (meshprotocol.dev)...\n");

  const natsForTasks = await connect({
    servers: NATS_SERVER,
    token: NATS_TOKEN || undefined,
  });

  const mesh = new MeshClient({
    natsUrl: NATS_SERVER,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
    region: "global",
    natsAuth: NATS_TOKEN ? { token: NATS_TOKEN } : undefined,
  });

  const model = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5-nano",
  });

  const agent = new Agent({
    id: "math-expert-public",
    name: "MathExpertPublic",
    model,
    memory: new InMemory(),
    instructions: `You are a math specialist. Answer only calculation and numeric expression questions.
Reply ONLY with the numeric result or simplified expression, no long explanations.
Examples: "what is 2+2?" -> "4". "What is 15 * 3?" -> "45".`,
  });

  console.log("[MathExpert] Registering on public registry...");
  const reg = await mesh.register(agentCardJson);
  console.log("[MathExpert] Registered:", reg.id, reg.status);
  console.log("[MathExpert] Listening for matches (Ctrl+C to exit)...\n");

  await mesh.listen(async (match) => {
    const sessionId = match.sessionId;
    const taskSubject = TASK_SUBJECT_PREFIX + sessionId;
    const resultSubject = RESULT_SUBJECT_PREFIX + sessionId;

    console.log("[MathExpert] Match received, sessionId:", sessionId);

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

    console.log("[MathExpert] Question:", question);

    try {
      await agent.addMessage({ role: "user", content: question });
      const result = await agent.execute();
      const answer = (result.content && typeof result.content === "string")
        ? result.content.trim()
        : "(no response)";
      console.log("[MathExpert] Response:", answer);

      natsForTasks.publish(resultSubject, new TextEncoder().encode(JSON.stringify({ result: answer })));
    } catch (err) {
      console.error("[MathExpert] Error:", err.message);
      natsForTasks.publish(resultSubject, new TextEncoder().encode(JSON.stringify({ result: "", error: err.message })));
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
