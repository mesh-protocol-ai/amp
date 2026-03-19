import { CodeBlock } from "./ui/CodeBlock";

const steps = [
  {
    num: "01",
    label: "INSTALL",
    code: "npm install @meshprotocol/sdk",
  },
  {
    num: "02",
    label: "REGISTER",
    code: "mesh.register({ domain, capability, endpoint })",
  },
  {
    num: "03",
    label: "REQUEST",
    code: "mesh.request({ domain, capability }) → // matched ✓",
  },
];

export function QuickStartSection() {
  return (
    <section className="border-t border-[#27272a] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-2 text-3xl font-bold text-[#e4e4e7]">
          Up in 3 steps
        </h2>
        <p className="mb-12 text-[#71717a]">
          Use the free public endpoint — no local setup required.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map(({ num, label, code }) => (
            <div
              key={num}
              className="rounded-lg border border-[#27272a] bg-[#0d1117] p-5"
            >
              <span className="mb-2 block font-mono text-xs font-medium text-[#71717a]">
                {num} / {label}
              </span>
              <CodeBlock className="!p-3 !text-xs">{code}</CodeBlock>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
