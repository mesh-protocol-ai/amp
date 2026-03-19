import { Network } from "lucide-react";
import {
  GITHUB_REPO_URL,
  SPEC_URL,
  DOCS_URL,
  HOSTING_URL,
  CONTRIBUTING_URL,
} from "@/lib/constants";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[#27272a] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-[#22d3ee] to-[#6366f1]">
            <Network className="h-4 w-4 text-white" />
          </span>
          <span className="font-semibold text-[#e4e4e7]">AMP</span>
        </div>
        <p className="text-sm text-[#71717a]">
          © {year} Agent Mesh Protocol. Apache-2.0.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a1a1aa] hover:text-[#e4e4e7]"
          >
            GitHub
          </a>
          <a
            href={SPEC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a1a1aa] hover:text-[#e4e4e7]"
          >
            Spec
          </a>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a1a1aa] hover:text-[#e4e4e7]"
          >
            Docs
          </a>
          <a
            href={HOSTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a1a1aa] hover:text-[#e4e4e7]"
          >
            HOSTING.md
          </a>
          <a
            href={CONTRIBUTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a1a1aa] hover:text-[#e4e4e7]"
          >
            CONTRIBUTING.md
          </a>
        </div>
      </div>
    </footer>
  );
}
