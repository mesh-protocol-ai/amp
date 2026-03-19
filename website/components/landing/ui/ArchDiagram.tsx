import { Database, Radio, Zap, Bot } from "lucide-react";

export function ArchDiagram() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-[#27272a] bg-[#0d1117] px-4 py-3">
          <Database className="h-5 w-5 text-[#22d3ee]" />
          <span className="text-sm font-medium text-[#e4e4e7]">Registry</span>
        </div>
        <span className="text-[#52525b]">⟷</span>
        <div className="flex items-center gap-3 rounded-lg border border-[#27272a] bg-[#0d1117] px-4 py-3">
          <Radio className="h-5 w-5 text-[#22d3ee]" />
          <span className="text-sm font-medium text-[#e4e4e7]">NATS Broker</span>
        </div>
        <span className="text-[#52525b]">⟷</span>
        <div className="flex items-center gap-3 rounded-lg border border-[#27272a] bg-[#0d1117] px-4 py-3">
          <Zap className="h-5 w-5 text-[#22d3ee]" />
          <span className="text-sm font-medium text-[#e4e4e7]">Matching Engine</span>
        </div>
      </div>
      <p className="text-xs font-medium uppercase tracking-wider text-[#71717a]">
        Control plane
      </p>
      <span className="text-[#52525b]">↓</span>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-[#6366f1]/40 bg-[#0d1117] px-4 py-3">
          <Bot className="h-5 w-5 text-[#6366f1]" />
          <span className="text-sm font-medium text-[#e4e4e7]">Consumer Agent</span>
        </div>
        <span className="text-[#52525b]">⟷</span>
        <div className="flex items-center gap-3 rounded-lg border border-[#4ade80]/40 bg-[#0d1117] px-4 py-3">
          <Bot className="h-5 w-5 text-[#4ade80]" />
          <span className="text-sm font-medium text-[#e4e4e7]">Provider Agent</span>
        </div>
      </div>
      <p className="text-xs font-medium uppercase tracking-wider text-[#71717a]">
        Data plane (gRPC · TLS)
      </p>
    </div>
  );
}
