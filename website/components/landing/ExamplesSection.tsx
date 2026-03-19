import { ExternalLink, Zap } from "lucide-react";
import { EXAMPLE_PUBLIC, EXAMPLE_ENTERPRISE } from "@/lib/constants";

const examples = [
  {
    href: EXAMPLE_PUBLIC,
    title: "Math Specialist + OpenAI",
    path: "examples/public-mesh-openai-demo",
    stat: "<200ms · Public endpoint",
  },
  {
    href: EXAMPLE_ENTERPRISE,
    title: "Multi-department Parallel",
    path: "examples/enterprise-mesh-demo",
    stat: "~380ms · 3 agents in parallel",
  },
];

export function ExamplesSection() {
  return (
    <section className="border-t border-[#27272a] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-12 text-3xl font-bold text-[#e4e4e7]">Examples</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {examples.map(({ href, title, path, stat }) => (
            <a
              key={path}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start justify-between gap-4 rounded-lg border border-[#27272a] bg-[#0d1117] p-6 transition hover:border-[#3f3f46]"
            >
              <div>
                <p className="font-mono text-sm text-[#22d3ee]">{path}</p>
                <h3 className="mt-2 font-semibold text-[#e4e4e7]">{title}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-[#71717a]">
                  <Zap className="h-3.5 w-3.5 text-[#4ade80]" />
                  {stat}
                </p>
              </div>
              <ExternalLink className="h-5 w-5 shrink-0 text-[#71717a] transition group-hover:text-[#22d3ee]" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
