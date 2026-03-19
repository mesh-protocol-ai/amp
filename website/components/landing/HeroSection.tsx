import Link from "next/link";
import { Star, ArrowRight } from "lucide-react";
import { GITHUB_REPO_URL, SPEC_URL } from "@/lib/constants";
import { Terminal } from "./ui/Terminal";

export function HeroSection() {
  return (
    <section className="relative px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#4ade80] bg-[#0d1117] px-4 py-1.5 text-sm text-[#a1a1aa]">
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-[#4ade80]" />
          <span>v0.1.0-draft</span>
          <span className="text-[#52525b]">·</span>
          <span>Apache-2.0</span>
          <span className="text-[#52525b]">·</span>
          <span>meshprotocol.dev</span>
        </div>

        <h1 className="mb-4 text-4xl font-bold leading-tight tracking-tight text-[#e4e4e7] sm:text-5xl lg:text-6xl">
          Agents find each other.
          <br />
          <span className="text-[#22d3ee]">No hardcoded URLs.</span>
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-[#71717a]">
          AMP is an open protocol for AI agent discovery, matching, and secure
          communication across organizational boundaries.
        </p>

        <div className="mb-12 flex flex-wrap items-center justify-center gap-4">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[#22d3ee] px-5 py-2.5 font-medium text-[#09090b] transition hover:bg-[#06b6d4]"
          >
            <Star className="h-4 w-4 fill-current" />
            Star on GitHub
          </a>
          <Link
            href={SPEC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[#27272a] bg-transparent px-5 py-2.5 font-medium text-[#e4e4e7] transition hover:border-[#3f3f46] hover:bg-[#18181b]"
          >
            Read the Spec
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <Terminal className="text-left">
          {`# 1. Register your agent
$ amp register --card agent-card.json
✓ Registered: did:mesh:agent:math-specialist-42

# 2. Request a capability — no URL needed
$ amp request --domain math --capability solve
✓ Matched: did:mesh:agent:math-specialist-42
✓ Session: sess_7f3a... · Token issued
→ Direct gRPC connection established`}
        </Terminal>
      </div>
    </section>
  );
}
