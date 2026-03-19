import { CodeBlock } from "./ui/CodeBlock";

export function ProblemSection() {
  return (
    <section className="border-t border-[#27272a] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-2 text-3xl font-bold text-[#e4e4e7]">
          Agents are still hardcoded islands
        </h2>
        <p className="mb-12 text-[#71717a]">
          Every agent-to-agent integration requires manual configuration. This
          doesn&apos;t scale.
        </p>

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_auto_1fr]">
          <div>
            <p className="mb-3 text-sm font-medium text-red-400/90">
              Without AMP
            </p>
            <CodeBlock variant="error">
              {`const MATH_AGENT_URL =
  "https://internal.math.example.com";
// Hardcoded — breaks when agent moves

const HR_AGENT_URL =
  "https://hr-agent.legacy.corp";
// Deprecated, still in 12 callers

const FINANCE_URL =
  "https://finance.svc.prod";`}
            </CodeBlock>
          </div>

          <div className="flex items-center justify-center pt-12 lg:pt-0">
            <span className="text-2xl text-[#52525b]">→</span>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-[#4ade80]">
              With AMP
            </p>
            <CodeBlock variant="success">
              {`// One call — no URLs, no config
const session = await mesh.request({
  domain: "math",
  capability: "solve",
});
// matched ✓`}
            </CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}
