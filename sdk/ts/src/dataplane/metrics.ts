import * as client from 'prom-client';

export type DataPlanePhase = 'handshake' | 'transfer' | 'processing';

export interface DataPlaneObservability {
  register: client.Registry;
  handshakeCounter: client.Counter<string>;
  transferCounter: client.Counter<string>;
  phaseLatency: client.Histogram<string>;
  bytesCounter: client.Counter<string>;
}

export function createDataPlaneObservability(options: { prefix?: string; register?: client.Registry } = {}): DataPlaneObservability {
  const register = options.register ?? new client.Registry();
  client.collectDefaultMetrics({ register, prefix: options.prefix ?? 'mesh_provider_' });

  const handshakeCounter = new client.Counter({
    name: `${options.prefix ?? 'mesh_provider_'}dataplane_handshake_total`,
    help: 'Total handshake attempts by outcome and reason',
    labelNames: ['outcome', 'reason'],
    registers: [register],
  });

  const transferCounter = new client.Counter({
    name: `${options.prefix ?? 'mesh_provider_'}dataplane_transfer_total`,
    help: 'Total transfer attempts by outcome and reason',
    labelNames: ['outcome', 'reason'],
    registers: [register],
  });

  const phaseLatency = new client.Histogram({
    name: `${options.prefix ?? 'mesh_provider_'}dataplane_phase_duration_seconds`,
    help: 'Latency by dataplane phase',
    labelNames: ['phase'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  });

  const bytesCounter = new client.Counter({
    name: `${options.prefix ?? 'mesh_provider_'}dataplane_bytes_total`,
    help: 'Total bytes transferred by direction (sent/received)',
    labelNames: ['direction'],
    registers: [register],
  });

  return {
    register,
    handshakeCounter,
    transferCounter,
    phaseLatency,
    bytesCounter,
  };
}
