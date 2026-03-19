import Link from "next/link";
import { Network, Star } from "lucide-react";
import { GITHUB_REPO_URL } from "@/lib/constants";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-[#27272a] bg-[#18181b]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-[#22d3ee] to-[#6366f1]">
            <Network className="h-4 w-4 text-white" />
          </span>
          <span className="font-semibold text-[#e4e4e7]">AMP</span>
          <span className="rounded bg-[#27272a] px-1.5 py-0.5 text-xs font-mono text-[#71717a]">
            v0.1.0
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <Link
            href={`${GITHUB_REPO_URL}/tree/main/docs`}
            className="text-sm text-[#a1a1aa] transition hover:text-[#e4e4e7]"
          >
            Docs
          </Link>
          <Link
            href={`${GITHUB_REPO_URL}/blob/main/SPECS.md`}
            className="text-sm text-[#a1a1aa] transition hover:text-[#e4e4e7]"
          >
            Spec
          </Link>
          <Link
            href={`${GITHUB_REPO_URL}/tree/main/examples`}
            className="text-sm text-[#a1a1aa] transition hover:text-[#e4e4e7]"
          >
            Examples
          </Link>
          <Link
            href={`${GITHUB_REPO_URL}/blob/main/HOSTING.md`}
            className="text-sm text-[#a1a1aa] transition hover:text-[#e4e4e7]"
          >
            Self-host
          </Link>
        </div>

        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-[#22d3ee] px-4 py-2 text-sm font-medium text-[#09090b] transition hover:bg-[#06b6d4]"
        >
          <Star className="h-4 w-4 fill-current" />
          Star on GitHub
        </a>
      </div>
    </nav>
  );
}
