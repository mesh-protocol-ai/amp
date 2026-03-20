/**
 * relay.ts — AMP Data Plane Relay tunnel client (provider side).
 *
 * Providers running behind NAT connect outbound to the relay service.
 * The relay bridges incoming consumer gRPC connections transparently,
 * so no port forwarding or public IP is needed on the provider side.
 *
 * Usage:
 *
 *   const tunnel = await startRelayTunnel({
 *     relayHost: 'relay.your-domain.com',
 *     agentDID: 'did:mesh:agent:my-provider',
 *     localGrpcPort: 50051,
 *   });
 *
 *   // Use tunnel.grpcAddress as data_plane.grpc in the Agent Card:
 *   console.log(tunnel.grpcAddress); // "relay.your-domain.com:50143"
 *
 *   // On shutdown:
 *   tunnel.close();
 *
 * Protocol (text, newline-delimited):
 *
 *   Provider → relay CONTROL_PORT:
 *     "REGISTER {did}\n"       register and obtain assigned consumer port
 *   Relay → provider:
 *     "OK {port}\n"            assigned port (deterministic from DID hash)
 *     "CONNECT {connID}\n"     relay asks provider to open a data channel
 *   Provider → relay DATA_PORT (new TCP connection per consumer):
 *     "DATA {connID}\n"        identifies which consumer this channel serves
 */

import net from 'node:net';
import { createInterface } from 'node:readline';

export interface RelayTunnelOptions {
  /** Hostname or IP of the relay server (e.g. the EC2 public IP). */
  relayHost: string;
  /** Port where providers send REGISTER (default: 7000). */
  controlPort?: number;
  /** Port where providers open per-consumer data channels (default: 7001). */
  dataPort?: number;
  /** The provider agent DID — used to derive the assigned consumer port. */
  agentDID: string;
  /** Local port where the provider's gRPC server is listening. */
  localGrpcPort: number;
  /** Interval in ms for sending PING keepalives (default: 30 000). */
  heartbeatIntervalMs?: number;
  /** Called when the control connection drops unexpectedly. */
  onDisconnect?: (err?: Error) => void;
  /**
   * URI scheme to prefix the returned `grpcAddress`.
   *
   * - `'grpc'`  (default) — plain TCP / insecure. Recommended for relay because
   *   the relay is a transparent TCP proxy: TLS certificates issued for the
   *   provider's own hostname are not valid for the relay's hostname, so TLS
   *   verification would always fail on the consumer side.
   * - `'grpcs'` — use only when the relay performs TLS termination and holds a
   *   certificate valid for `relayHost`.
   */
  grpcScheme?: 'grpc' | 'grpcs';
}

export interface RelayTunnelHandle {
  /** The consumer-facing gRPC address to put in Agent Card data_plane.grpc. */
  grpcAddress: string;
  /** The numeric port component of grpcAddress. */
  assignedPort: number;
  /** Closes the control connection and stops keepalives. */
  close(): void;
}

/**
 * Connects to the relay control port, registers the provider DID, and starts
 * handling inbound data-channel requests.
 *
 * Resolves once "OK {port}" is received from the relay.
 * Rejects if the relay sends an ERR or the connection fails during handshake.
 */
export function startRelayTunnel(options: RelayTunnelOptions): Promise<RelayTunnelHandle> {
  const {
    relayHost,
    controlPort = 7000,
    dataPort = 7001,
    agentDID,
    localGrpcPort,
    heartbeatIntervalMs = 30_000,
    onDisconnect,
  } = options;

  return new Promise<RelayTunnelHandle>((resolve, reject) => {
    const control = net.connect(controlPort, relayHost);
    let settled = false;
    let hbInterval: ReturnType<typeof setInterval> | null = null;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      control.destroy();
      reject(err);
    };

    const rl = createInterface({ input: control, crlfDelay: Infinity });

    rl.on('line', (raw: string) => {
      const line = raw.trim();

      if (line.startsWith('OK ')) {
        if (settled) return;
        settled = true;

        const assignedPort = parseInt(line.slice(3), 10);
        if (isNaN(assignedPort)) {
          fail(new Error(`relay: invalid port in OK response: "${line}"`));
          return;
        }

        // Start keepalive pings.
        hbInterval = setInterval(() => {
          if (!control.destroyed) control.write('PING\n');
        }, heartbeatIntervalMs);

        const scheme = options.grpcScheme ?? 'grpc';
        resolve({
          assignedPort,
          grpcAddress: `${scheme}://${relayHost}:${assignedPort}`,
          close() {
            if (hbInterval) clearInterval(hbInterval);
            control.destroy();
          },
        });
        return;
      }

      if (line.startsWith('CONNECT ')) {
        // Relay is asking us to open a data channel for a consumer.
        const connID = line.slice(8).trim();
        if (connID) {
          openDataChannel(connID, relayHost, dataPort, localGrpcPort);
        }
        return;
      }

      if (line.startsWith('ERR ')) {
        fail(new Error(`relay: ${line}`));
      }
    });

    control.on('connect', () => {
      control.write(`REGISTER ${agentDID}\n`);
    });

    control.on('error', (err) => {
      if (!settled) {
        fail(err);
      } else {
        if (hbInterval) clearInterval(hbInterval);
        onDisconnect?.(err);
      }
    });

    control.on('close', () => {
      if (hbInterval) clearInterval(hbInterval);
      if (!settled) {
        fail(new Error('relay: control connection closed before registration'));
      } else {
        onDisconnect?.();
      }
    });
  });
}

/**
 * Opens a new TCP connection to the relay DATA_PORT, identifies the
 * connection with the given connID, then pipes data to/from the local
 * gRPC server.
 *
 * Each consumer connection requires one call to this function.
 */
function openDataChannel(
  connID: string,
  relayHost: string,
  dataPort: number,
  localGrpcPort: number,
): void {
  const toRelay = net.connect(dataPort, relayHost);

  toRelay.once('connect', () => {
    // Identify this data channel to the relay.
    toRelay.write(`DATA ${connID}\n`);

    // Connect to the local gRPC server.
    const toLocal = net.connect(localGrpcPort, '127.0.0.1');

    toLocal.once('connect', () => {
      // Bidirectional pipe: relay ↔ local gRPC
      toRelay.pipe(toLocal);
      toLocal.pipe(toRelay);

      toRelay.once('close', () => toLocal.destroy());
      toLocal.once('close', () => toRelay.destroy());
    });

    toLocal.once('error', (err) => {
      console.error(`relay: local gRPC connect error (conn=${connID}):`, err.message);
      toRelay.destroy();
    });
  });

  toRelay.once('error', (err) => {
    console.error(`relay: data channel error (conn=${connID}):`, err.message);
    toRelay.destroy();
  });
}

/**
 * Computes the deterministic port that the relay assigns to a given DID.
 * Mirrors the FNV-32a hash used in the Go relay service, so providers can
 * calculate their public address locally before registering.
 *
 * @param did           - The provider agent DID string.
 * @param portRangeStart - First port in the relay's consumer pool (default: 50100).
 * @param portRangeSize  - Number of ports in the pool (default: 100).
 */
export function computeRelayPort(
  did: string,
  portRangeStart = 50100,
  portRangeSize = 100,
): number {
  // FNV-32a — must match services/relay/relay.go AssignedPort()
  let hash = 0x811c9dc5;
  for (let i = 0; i < did.length; i++) {
    hash ^= did.charCodeAt(i);
    // Simulate 32-bit unsigned multiplication by FNV prime (0x01000193)
    hash = (Math.imul(hash, 0x01000193) >>> 0);
  }
  return portRangeStart + (hash % portRangeSize);
}


