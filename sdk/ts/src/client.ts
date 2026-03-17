/**
 * MeshClient - SDK API: register, request, listen.
 */

import type { NatsConnection, Subscription } from 'nats';
import { connect } from 'nats';
import type { AgentCard } from './contracts/agent-card.js';
import { validateAgentCard } from './contracts/agent-card.js';
import type {
  CapabilityMatchData,
  CapabilityRejectData,
  MatchResult,
  RejectResult,
} from './contracts/events.js';
import { matchDataToResult } from './contracts/events.js';
import {
  newCloudEvent,
  parseCloudEvent,
  getAMPExtensions,
  serializeCloudEvent,
  EVENT_TYPES,
} from './cloudevents.js';

const MESH_MATCHES_SUBJECT = 'mesh.matches';

export interface MeshClientOptions {
  natsUrl: string;
  registryUrl: string;
  did: string;
  auth?: {
    type: 'api_key' | 'bearer';
    apiKey?: string;
    token?: string;
  };
  natsAuth?: { token?: string };
  region?: string;
}

export interface RegisterOptions {
  status?: 'active' | 'draft';
}

export interface RegisterResult {
  id: string;
  status: string;
}

export interface RequestOptions {
  domain: string[];
  capabilityId: string;
  description?: string;
  language?: string;
  constraints?: {
    maxLatencyMs?: number;
    maxCostUsd?: number;
    minTrustScore?: number;
    dataResidency?: string[];
  };
  timeoutMs?: number;
}

export type MatchHandler = (match: MatchResult) => void | Promise<void>;

export interface ListenSubscription {
  unsubscribe(): Promise<void>;
}

export class MeshClient {
  private readonly options: MeshClientOptions;
  private nc: NatsConnection | null = null;

  constructor(options: MeshClientOptions) {
    this.options = {
      region: 'global',
      ...options,
    };
  }

  /**
   * Connects to NATS lazily. Reuses the same connection.
   */
  private async getNats(): Promise<NatsConnection> {
    if (this.nc) return this.nc;
    const opts: { servers: string; token?: string } = {
      servers: this.options.natsUrl,
    };
    if (this.options.natsAuth?.token) {
      opts.token = this.options.natsAuth.token;
    }
    this.nc = await connect(opts);
    return this.nc;
  }

  private registryHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const auth = this.options.auth;
    if (auth?.type === 'api_key' && auth.apiKey) {
      headers['X-API-Key'] = auth.apiKey;
    } else if (auth?.type === 'bearer' && auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    }
    return headers;
  }

  /**
   * Registers or updates an Agent Card in the Registry.
   */
  async register(agentCard: AgentCard, options?: RegisterOptions): Promise<RegisterResult> {
    validateAgentCard(agentCard);
    const url = `${this.options.registryUrl.replace(/\/$/, '')}/agents`;
    const status = options?.status ?? 'active';
    const params = new URLSearchParams();
    if (status !== 'active') params.set('status', status);
    const fullUrl = params.toString() ? `${url}?${params}` : url;
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: this.registryHeaders(),
      body: JSON.stringify(agentCard),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Registry error ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { id?: string; status?: string };
    return {
      id: body.id ?? agentCard.metadata.id,
      status: body.status ?? status,
    };
  }

  /**
   * Publishes a capability request and waits for match or reject.
   */
  async request(options: RequestOptions): Promise<MatchResult | RejectResult> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const nc = await this.getNats();
    const region = this.options.region ?? 'global';
    const subject = `mesh.requests.${options.domain.join('.')}.${region}`;

    const requestData = {
      task: {
        capability_id: options.capabilityId,
        domain: options.domain,
        description: options.description,
        language: options.language,
      },
      constraints: options.constraints
        ? {
            max_latency_ms: options.constraints.maxLatencyMs,
            max_cost_usd: options.constraints.maxCostUsd,
            min_trust_score: options.constraints.minTrustScore,
            data_residency: options.constraints.dataResidency,
          }
        : undefined,
    };

    const ev = newCloudEvent(
      EVENT_TYPES.CAPABILITY_REQUEST,
      this.options.did,
      requestData,
      {}
    );
    ev.correlationid = ev.id;
    const requestId = ev.id;

    return await new Promise<MatchResult | RejectResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const sub = nc.subscribe(MESH_MATCHES_SUBJECT, {
        callback: (err, msg) => {
          if (err) {
            clearTimeout(timeout);
            sub.unsubscribe();
            reject(err);
            return;
          }
          if (!msg?.data) return;
          try {
            const event = parseCloudEvent(msg.data);
            const ext = getAMPExtensions(event);
            const correlationMatch =
              ext.correlationid === requestId ||
              (event.data && (event.data as { request_id?: string }).request_id === requestId);
            if (!correlationMatch) return;

            if (event.type === EVENT_TYPES.CAPABILITY_MATCH) {
              clearTimeout(timeout);
              sub.unsubscribe();
              const data = event.data as CapabilityMatchData;
              resolve(matchDataToResult(data));
            } else if (event.type === EVENT_TYPES.CAPABILITY_REJECT) {
              clearTimeout(timeout);
              sub.unsubscribe();
              const data = event.data as CapabilityRejectData;
              resolve({
                kind: 'reject',
                requestId: data.request_id,
                reason: data.reason,
              });
            }
          } catch {
            // ignore parse errors for other messages
          }
        },
      });

      nc.publish(subject, new TextEncoder().encode(serializeCloudEvent(ev)));
    });
  }

  /**
   * Listens for matches addressed to this agent (provider).
   */
  async listen(handler: MatchHandler): Promise<ListenSubscription> {
    const nc = await this.getNats();
    const did = this.options.did;

    const sub = nc.subscribe(MESH_MATCHES_SUBJECT, {
      callback: async (err, msg) => {
        if (err || !msg?.data) return;
        try {
          const event = parseCloudEvent(msg.data);
          if (event.type !== EVENT_TYPES.CAPABILITY_MATCH) return;
          const data = event.data as CapabilityMatchData;
          if (data.parties?.provider !== did) return;
          const result = matchDataToResult(data);
          await Promise.resolve(handler(result));
        } catch {
          // ignore
        }
      },
    });

    return {
      async unsubscribe() {
        await sub.unsubscribe();
      },
    };
  }

  /**
   * Closes the NATS connection (optional; useful in tests or shutdown).
   */
  async close(): Promise<void> {
    if (this.nc) {
      await this.nc.close();
      this.nc = null;
    }
  }
}
