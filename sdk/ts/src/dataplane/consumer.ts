import { createDataPlaneClient, grpc } from './grpc.js';
import { createChunkOpen } from './crypto.js';
import { DataPlanePhase } from './metrics.js';

/** Per-call timing and byte statistics returned from DataPlaneConsumerClient.call(). */
export interface CallMeta {
  /** Milliseconds spent in the Handshake RPC. */
  handshake_ms: number;
  /** Milliseconds spent in the Transfer streaming RPC. */
  transfer_ms: number;
  /** Milliseconds spent waiting for the Result stream. */
  result_ms: number;
  /** Total milliseconds for the full call (handshake + transfer + result). */
  total_ms: number;
  /** Bytes written in the Transfer payload. */
  bytes_sent: number;
  /** Bytes received in the Result payload. */
  bytes_received: number;
  /** Session identifier used for this call. */
  sessionId: string;
}

export interface DataPlaneConsumerMetricsHooks {
  handshakeCounter?: { inc: (labels: { outcome: string; reason: string }) => void };
  transferCounter?: { inc: (labels: { outcome: string; reason: string }) => void };
  phaseLatency?: { startTimer: (labels: { phase: DataPlanePhase }) => () => void };
  bytesCounter?: { inc: (labels: { direction: 'sent' | 'received' }, value: number) => void };
  onCall?: (meta: CallMeta) => void;
}

export interface DataPlaneConsumerOptions {
  insecure?: boolean;
  caCertPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  serverName?: string;
  metrics?: DataPlaneConsumerMetricsHooks;
}

export class DataPlaneConsumerClient {
  private endpoint: string;
  private client: any;
  private options: DataPlaneConsumerOptions;
  private metrics?: DataPlaneConsumerMetricsHooks;

  constructor(endpoint: string, options: DataPlaneConsumerOptions = {}) {
    this.endpoint = endpoint;
    this.options = options;
    this.metrics = options.metrics;
    this.client = createDataPlaneClient(endpoint, {
      insecure: options.insecure,
      caCertPath: options.caCertPath,
      clientCertPath: options.clientCertPath,
      clientKeyPath: options.clientKeyPath,
      serverName: options.serverName,
    });
  }

  async call(opts: { sessionId: string; sessionToken: string; payload: Buffer; timeoutMs?: number; }): Promise<{ result: Buffer; meta: CallMeta }> {
    const { sessionId, sessionToken, payload, timeoutMs = 15000 } = opts;
    const callStart = Date.now();

    // Handshake
    const handshakeStart = Date.now();
    const handshakeTimer = this.metrics?.phaseLatency?.startTimer?.({ phase: 'handshake' });
    await new Promise<void>((resolve, reject) => {
      this.client.Handshake({ session_id: sessionId, session_token: sessionToken }, (err: any) => {
        if (err) {
          this.metrics?.handshakeCounter?.inc?.({ outcome: 'failure', reason: 'handshake_error' });
          handshakeTimer?.();
          return reject(err);
        }
        this.metrics?.handshakeCounter?.inc?.({ outcome: 'success', reason: 'ok' });
        handshakeTimer?.();
        resolve();
      });
    });
    const handshake_ms = Date.now() - handshakeStart;

    // Transfer (streaming)
    const transferStart = Date.now();
    const transferTimer = this.metrics?.phaseLatency?.startTimer?.({ phase: 'transfer' });
    let transferDone = false;
    const transferComplete = (outcome: 'success' | 'failure', reason: string) => {
      if (transferDone) return;
      transferDone = true;
      this.metrics?.transferCounter?.inc?.({ outcome, reason });
      transferTimer?.();
    };

    await new Promise<void>((resolve, reject) => {
      const metadata = new grpc.Metadata();
      metadata.set('x-session-id', sessionId);
      const call = this.client.Transfer(metadata, (err: any, ack: any) => {
        if (err) {
          transferComplete('failure', 'transfer_error');
          return reject(err);
        }
        if (!ack || !ack.accepted) {
          transferComplete('failure', 'transfer_rejected');
          return reject(new Error(ack?.error_message || 'transfer_rejected'));
        }
        transferComplete('success', 'ok');
        resolve();
      });
      const openChunk = createChunkOpen(payload, 1, true);
      call.write({
        ciphertext: openChunk.ciphertext,
        nonce: openChunk.nonce,
        sequence: openChunk.sequence,
        is_final: openChunk.is_final,
        algorithm: openChunk.algorithm,
      });
      call.end();
    });
    const transfer_ms = Date.now() - transferStart;
    this.metrics?.bytesCounter?.inc?.({ direction: 'sent' }, payload.length);

    // Result (stream)
    const resultStart = Date.now();
    const resultTimer = this.metrics?.phaseLatency?.startTimer?.({ phase: 'processing' });
    const result = await new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for result')), timeoutMs);
      let resolved = false;
      const stream = this.client.Result({ session_id: sessionId });
      stream.on('data', (chunk: any) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resultTimer?.();
        try {
          resolve(Buffer.from(chunk.ciphertext || []));
        } catch (err) {
          reject(err);
        }
      });
      stream.on('error', (err: any) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resultTimer?.();
        reject(err);
      });
      stream.on('end', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resultTimer?.();
          reject(new Error('Result stream ended without data'));
        }
      });
    });
    const result_ms = Date.now() - resultStart;
    const total_ms = Date.now() - callStart;

    this.metrics?.bytesCounter?.inc?.({ direction: 'received' }, result.length);

    const meta: CallMeta = {
      handshake_ms,
      transfer_ms,
      result_ms,
      total_ms,
      bytes_sent: payload.length,
      bytes_received: result.length,
      sessionId,
    };
    this.metrics?.onCall?.(meta);

    return { result, meta };
  }

  close(): void {
    if (this.client && typeof this.client.close === 'function') {
      try { this.client.close(); } catch (_) {}
    }
  }
}

export default DataPlaneConsumerClient;
