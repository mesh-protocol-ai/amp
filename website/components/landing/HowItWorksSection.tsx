import { ArchDiagram } from "./ui/ArchDiagram";

export function HowItWorksSection() {
  return (
    <section className="border-t border-[#27272a] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-2 text-3xl font-bold text-[#e4e4e7]">
          Control plane + Data plane
        </h2>
        <p className="mb-12 text-[#71717a]">
          Discovery via NATS event broker. Communication via direct gRPC with
          TLS.
        </p>
        <ArchDiagram />
      </div>
    </section>
  );
}
