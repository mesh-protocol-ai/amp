import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const total = Number(process.argv[2] || 20);
const concurrency = Number(process.argv[3] || 5);
const question = process.argv.slice(4).join(" ") || "Quanto e 22 + 18 ^ 4?";

if (!Number.isFinite(total) || total <= 0) {
  console.error("[load-consumers] total must be > 0");
  process.exit(1);
}
if (!Number.isFinite(concurrency) || concurrency <= 0) {
  console.error("[load-consumers] concurrency must be > 0");
  process.exit(1);
}

const demoRoot = path.resolve(process.cwd());
const consumerDir = path.join(demoRoot, "consumer");

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function parseTiming(stdout) {
  const matches = [...stdout.matchAll(/\[Consumer\]\[timing\]\s+(\{.*\})/g)];
  if (!matches.length) return null;
  try {
    return JSON.parse(matches[matches.length - 1][1]);
  } catch {
    return null;
  }
}

function runOne(id) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("node", ["--env-file=../.env", "index.js", question], {
      cwd: consumerDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("close", (code) => {
      const finishedAt = Date.now();
      const timing = parseTiming(stdout);
      resolve({
        id,
        code,
        elapsed_ms: finishedAt - startedAt,
        timing,
        ok: code === 0 && timing?.outcome === "ok",
        stderr: stderr.trim(),
      });
    });
  });
}

async function main() {
  console.log(`[load-consumers] starting load: total=${total} concurrency=${concurrency}`);
  console.log(`[load-consumers] question=\"${question}\"`);

  const queue = Array.from({ length: total }, (_, i) => i + 1);
  const results = [];

  async function worker(workerId) {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      const r = await runOne(id);
      results.push(r);
      const status = r.ok ? "ok" : "fail";
      const t = r.timing?.total_ms ?? r.elapsed_ms;
      console.log(`[load-consumers] #${id} worker=${workerId} ${status} total_ms=${t}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, (_, i) => worker(i + 1)));

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);

  const fields = [
    "match_ms",
    "registry_lookup_ms",
    "handshake_ms",
    "transfer_ack_ms",
    "result_wait_ms",
    "total_ms",
  ];

  const summary = {};
  for (const f of fields) {
    const vals = ok.map((r) => r.timing?.[f]).filter((v) => typeof v === "number");
    summary[f] = {
      count: vals.length,
      avg: avg(vals),
      p50: percentile(vals, 50),
      p95: percentile(vals, 95),
      p99: percentile(vals, 99),
      max: vals.length ? Math.max(...vals) : null,
    };
  }

  const out = {
    generated_at: new Date().toISOString(),
    total,
    concurrency,
    question,
    success: ok.length,
    failed: fail.length,
    summary,
    failures: fail.map((f) => ({
      id: f.id,
      code: f.code,
      elapsed_ms: f.elapsed_ms,
      outcome: f.timing?.outcome,
      error: f.timing?.error || f.stderr || "unknown",
    })),
  };

  const outDir = path.join(demoRoot, "observability", "results");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `load-${Date.now()}.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));

  console.log("\n[load-consumers] summary:");
  for (const f of fields) {
    const s = summary[f];
    console.log(
      `  - ${f}: count=${s.count} avg=${s.avg?.toFixed?.(1) ?? "n/a"} p50=${s.p50 ?? "n/a"} p95=${s.p95 ?? "n/a"} p99=${s.p99 ?? "n/a"} max=${s.max ?? "n/a"}`
    );
  }
  console.log(`[load-consumers] success=${ok.length} failed=${fail.length}`);
  console.log(`[load-consumers] report=${outPath}`);

  if (fail.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[load-consumers] failure:", err.message || err);
  process.exit(1);
});
