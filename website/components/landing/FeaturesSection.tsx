import { Search, Zap, Shield, Activity } from "lucide-react";

const features = [
  {
    icon: Search,
    title: "Agent Discovery",
    description:
      "Declarative Agent Cards. Registry with filters by domain and capability. No DNS, no hardcoded IPs.",
  },
  {
    icon: Zap,
    title: "Intelligent Matching",
    description:
      "Matching engine by latency, availability and capabilities. Support for parallel requests.",
  },
  {
    icon: Shield,
    title: "Security Layers",
    description:
      "OPEN (TLS + HMAC tokens). STANDARD (E2E encryption X25519 + AES-256-GCM). Community + Enterprise.",
  },
  {
    icon: Activity,
    title: "Audit Trail",
    description:
      "Session binding (consumer_did, provider_did, session_id). CloudEvents. Prometheus + Grafana.",
  },
];

export function FeaturesSection() {
  return (
    <section className="border-t border-[#27272a] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-12 text-3xl font-bold text-[#e4e4e7]">Features</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-lg border border-[#27272a] bg-[#0d1117] p-6"
            >
              <Icon className="mb-3 h-6 w-6 text-[#22d3ee]" />
              <h3 className="mb-2 font-semibold text-[#e4e4e7]">{title}</h3>
              <p className="text-sm text-[#71717a]">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
