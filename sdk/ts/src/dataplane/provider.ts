import type { AgentCard } from '../contracts/agent-card.js';
import { parseGrpcEndpoint } from './grpc.js';

export interface RegistryAuth {
  type: 'api_key' | 'bearer';
  apiKey?: string;
  token?: string;
}

export interface ResolveProviderDataPlaneOptions {
  providerDid: string;
  registryUrl: string;
  auth?: RegistryAuth;
  tlsServerName?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export interface ResolvedProviderDataPlaneEndpoint {
  grpcEndpoint: string;
  serverName?: string;
  card: AgentCard;
}

function buildHeaders(auth?: RegistryAuth): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth?.type === 'api_key' && auth.apiKey) {
    headers['X-API-Key'] = auth.apiKey;
  } else if (auth?.type === 'bearer' && auth.token) {
    headers['Authorization'] = `Bearer ${auth.token}`;
  }
  return headers;
}

function extractHost(target: string): string {
  if (!target) return '';
  if (target.startsWith('[')) {
    const closing = target.indexOf(']');
    if (closing > 0) {
      return target.slice(1, closing);
    }
  }
  const colon = target.indexOf(':');
  return colon === -1 ? target : target.slice(0, colon);
}

function defaultServerName(host: string): string {
  if (!host) return '';
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return 'localhost';
  }
  return host;
}

export async function resolveProviderDataPlaneEndpoint(
  options: ResolveProviderDataPlaneOptions,
): Promise<ResolvedProviderDataPlaneEndpoint> {
  const {
    registryUrl,
    providerDid,
    auth,
    tlsServerName,
    fetch: fetchOverride,
    signal,
  } = options;
  const fetcher = fetchOverride ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error('Fetch API is not available in this environment');
  }

  const url = `${registryUrl.replace(/\/$/, '')}/agents/${encodeURIComponent(providerDid)}`;
  const res = await fetcher(url, {
    headers: buildHeaders(auth),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Provider registry lookup failed: ${res.status}`);
  }
  const body = (await res.json()) as { card?: AgentCard };
  const card = body?.card;
  if (!card) {
    throw new Error('Registry response missing agent card');
  }
  const grpcEndpoint = card?.spec?.endpoints?.data_plane?.grpc?.trim();
  if (!grpcEndpoint) {
    throw new Error(`Provider ${providerDid} does not publish a data_plane.grpc endpoint`);
  }

  const { target } = parseGrpcEndpoint(grpcEndpoint, true);
  const host = extractHost(target);
  const serverName = tlsServerName ?? (host ? defaultServerName(host) : undefined);

  return {
    grpcEndpoint,
    serverName: serverName || undefined,
    card,
  };
}
