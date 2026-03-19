import { Star } from "lucide-react";
import { GITHUB_REPO_URL, MESHPROTOCOL_DEV } from "@/lib/constants";

export function CtaSection() {
  return (
    <section className="border-t border-[#27272a] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-[#27272a] bg-[#0d1117] p-10 text-center">
          <h2 className="mb-2 text-2xl font-bold text-[#e4e4e7] sm:text-3xl">
            Ready to mesh your agents?
          </h2>
          <p className="mb-6 text-[#71717a]">
            Open protocol · Apache-2.0 · Self-hostable · Free public endpoint
          </p>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-medium text-[#09090b] transition hover:bg-[#e4e4e7]"
          >
            <Star className="h-5 w-5 fill-current" />
            Star on GitHub
          </a>
          <p className="mt-4">
            <a
              href={MESHPROTOCOL_DEV}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#71717a] underline hover:text-[#22d3ee]"
            >
              or try it now → meshprotocol.dev (free)
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
