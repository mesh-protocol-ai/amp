import { createGrpcServer, DataPlaneService, grpc } from './grpc.js';
import { validateSimpleToken } from '../session/simple.js';
import { createChunkOpen } from './crypto.js';
import { DataPlanePhase, DataPlaneObservability } from './metrics.js';

export interface DataPlaneServerMetricsHooks {
  handshakeCounter?: { inc: (labels: { outcome: string; reason: string }) => void };
  transferCounter?: { inc: (labels: { outcome: string; reason: string }) => void };
  phaseLatency?: { startTimer: (labels: { phase: DataPlanePhase }) => () => void };
  bytesCounter?: { inc: (labels: { direction: 'received' | 'sent' }, value: number) => void };
}

export interface DataPlaneServerOptions {
  sessionTokenSecret: string;
  providerDid: string;
  metrics?: DataPlaneServerMetricsHooks;
}

export type SessionContext = {
  sessionId: string;
  sessionToken: string;
  consumerDid: string;
  providerDid?: string;
  handshakeOk?: boolean;
  lastSequence?: number;
  resultChunk?: any;
  /** Runtime stats accumulated during this session. */
  stats: SessionStats;
};

/** Byte and timing statistics accumulated for a single session. */
export interface SessionStats {
  /** Total bytes received across all Transfer chunks. */
  bytes_received: number;
  /** Bytes in the result payload sent back to the consumer. */
  bytes_sent: number;
  /** Transfer phase duration in milliseconds (set after Transfer completes). */
  transfer_ms: number;
  /** Processing phase duration in milliseconds (set after task handler returns). */
  processing_ms: number;
}

export class DataPlaneServer {
  private server: grpc.Server;
  private sessions: Map<string, SessionContext>;
  private taskHandler: ((payload: Buffer, session: SessionContext) => Promise<Buffer>) | null;
  private sessionTokenSecret: string;
  private providerDid: string;
  private metrics?: DataPlaneServerMetricsHooks;

  constructor(options: DataPlaneServerOptions) {
    this.sessionTokenSecret = options.sessionTokenSecret;
    this.providerDid = options.providerDid;
    this.metrics = options.metrics;
    this.server = createGrpcServer();
    this.sessions = new Map();
    this.taskHandler = null;

    const impl: any = {
      Handshake: (call: any, callback: any) => {
        (async () => {
          const timer = this.metrics?.phaseLatency?.startTimer?.({ phase: 'handshake' });
          try {
            const req = call.request || {};
            const sessionId = String(req.session_id || '');
            const session = this.sessions.get(sessionId);
            if (!session) {
              this.metrics?.handshakeCounter?.inc?.({ outcome: 'failure', reason: 'session_not_found' });
              callback({ code: grpc.status.NOT_FOUND, message: 'session_not_found' });
              return;
            }
            const valid = validateSimpleToken(
              req.session_token,
              this.sessionTokenSecret,
              sessionId,
              session.consumerDid,
              this.providerDid,
            );
            if (!valid) {
              this.metrics?.handshakeCounter?.inc?.({ outcome: 'failure', reason: 'invalid_session_token' });
              callback({ code: grpc.status.UNAUTHENTICATED, message: 'invalid_session_token' });
              return;
            }
            session.handshakeOk = true;
            session.lastSequence = 0;
            this.metrics?.handshakeCounter?.inc?.({ outcome: 'success', reason: 'ok' });
            callback(null, {
              provider_ephemeral_pub: Buffer.alloc(0),
              provider_did: this.providerDid,
              provider_did_signature: Buffer.alloc(0),
            });
          } catch (err: any) {
            this.metrics?.handshakeCounter?.inc?.({ outcome: 'failure', reason: 'internal_error' });
            callback({ code: grpc.status.INTERNAL, message: err?.message || 'internal_error' });
          } finally {
            timer?.();
          }
        })();
      },

      Transfer: (call: any, callback: any) => {
        const transferTimer = this.metrics?.phaseLatency?.startTimer?.({ phase: 'transfer' });
        const transferStart = Date.now();
        const md = call.metadata.get('x-session-id') ?? call.metadata.get('X-Session-Id');
        const raw = Array.isArray(md) ? md[0] : md;
        const sessionId = raw != null && raw !== '' ? String(raw) : '';
        const session = this.sessions.get(sessionId);
        if (!session || !session.handshakeOk) {
          this.metrics?.transferCounter?.inc?.({ outcome: 'failure', reason: 'handshake_required' });
          transferTimer?.();
          callback({ accepted: false, chunks_received: 0, error_code: 'handshake_required', error_message: 'handshake_required' });
          return;
        }

        const chunks: Buffer[] = [];
        let chunksReceived = 0;
        let transferCompleted = false;

        const completeTransfer = (outcome: 'success' | 'failure', reason: string) => {
          if (transferCompleted) return;
          transferCompleted = true;
          session.stats.transfer_ms = Date.now() - transferStart;
          this.metrics?.transferCounter?.inc?.({ outcome, reason });
          transferTimer?.();
        };

        call.on('data', (chunk: any) => {
          const sequence = Number(chunk.sequence || 0);
          if (sequence <= (session.lastSequence || 0)) {
            call.emit('error', { code: grpc.status.PERMISSION_DENIED, message: 'replay_detected' });
            return;
          }
          session.lastSequence = sequence;
          const chunkBuf = Buffer.from(chunk.ciphertext || []);
          session.stats.bytes_received += chunkBuf.length;
          chunks.push(chunkBuf);
          chunksReceived += 1;
        });

        call.on('error', (err: any) => {
          completeTransfer('failure', 'stream_error');
          callback({ accepted: false, chunks_received: chunksReceived, error_code: 'stream_error', error_message: String(err?.message || err) });
        });

        call.on('end', async () => {
          const processingTimer = this.metrics?.phaseLatency?.startTimer?.({ phase: 'processing' });
          const processingStart = Date.now();
          try {
            if (!this.taskHandler) {
              completeTransfer('failure', 'no_handler');
              callback({ accepted: false, chunks_received: chunksReceived, error_code: 'no_handler', error_message: 'no_task_handler' });
              return;
            }
            const payloadRaw = Buffer.concat(chunks);
            this.metrics?.bytesCounter?.inc?.({ direction: 'received' }, payloadRaw.length);
            const resultBuf = await this.taskHandler(payloadRaw, session);
            session.stats.processing_ms = Date.now() - processingStart;
            session.stats.bytes_sent = resultBuf.length;
            this.metrics?.bytesCounter?.inc?.({ direction: 'sent' }, resultBuf.length);
            session.resultChunk = createChunkOpen(resultBuf, (session.lastSequence || 0) + 1, true);
            session.lastSequence = (session.lastSequence || 0) + 1;
            completeTransfer('success', 'ok');
            callback(null, { accepted: true, chunks_received: chunksReceived });
          } catch (err: any) {
            completeTransfer('failure', 'process_error');
            callback({ accepted: false, chunks_received: chunksReceived, error_code: 'process_error', error_message: String(err?.message || err) });
          } finally {
            processingTimer?.();
          }
        });
      },

      Result: (call: any) => {
        const req = call.request || {};
        const sessionId = String(req.session_id || '');
        const session = this.sessions.get(sessionId);
        if (!session || !session.handshakeOk) {
          call.emit('error', { code: grpc.status.UNAUTHENTICATED, message: 'handshake_required' });
          return;
        }
        if (!session.resultChunk) {
          call.emit('error', { code: grpc.status.FAILED_PRECONDITION, message: 'result_not_ready' });
          return;
        }
        call.write(session.resultChunk);
        call.end();
      },

      StreamingTask: (stream: any) => {
        stream.emit('error', { code: grpc.status.UNIMPLEMENTED, message: 'not_implemented' });
      },
    };

    this.server.addService(DataPlaneService.service, impl);
  }

  onTask(handler: (payload: Buffer, session: SessionContext) => Promise<Buffer>): this {
    this.taskHandler = handler;
    return this;
  }

  addSession(session: { sessionId: string; sessionToken: string; consumerDid: string }): void {
    this.sessions.set(session.sessionId, {
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      consumerDid: session.consumerDid,
      providerDid: this.providerDid,
      handshakeOk: false,
      lastSequence: 0,
      resultChunk: null,
      stats: { bytes_received: 0, bytes_sent: 0, transfer_ms: 0, processing_ms: 0 },
    });
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  start(bind: string, serverCreds: grpc.ServerCredentials): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server.bindAsync(bind, serverCreds, (err: any, port: number) => {
        if (err) return reject(err);
        this.server.start();
        const host = bind.split(':')[0] || '0.0.0.0';
        resolve(`${host}:${port}`);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.tryShutdown(() => resolve()));
  }
}

export default DataPlaneServer;
