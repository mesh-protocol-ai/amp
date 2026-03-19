interface TerminalProps {
  children: React.ReactNode;
  className?: string;
}

export function Terminal({ children, className = "" }: TerminalProps) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117] font-mono text-sm shadow-xl ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-[#30363d] bg-[#161b22] px-4 py-2">
        <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
        <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
        <span className="ml-3 text-xs text-[#8b949e]">Terminal</span>
      </div>
      <pre className="overflow-x-auto p-4 text-[#e6edf3]">{children}</pre>
    </div>
  );
}
