# Data Plane Relay

## Problem

Provider agents running behind NAT (home networks, corporate firewalls, cloud VPCs without public IPs) cannot register a publicly-reachable `data_plane.grpc` address. When a consumer receives a match and tries to connect, the address stored in the Agent Card is a private IP that is unreachable from another network.

## Solution

The **Data Plane Relay** is a lightweight TCP-proxy service. Providers connect *outbound* to the relay (which is publicly accessible), register their DID, and keep a persistent control channel open. The relay assigns each provider a deterministic consumer-facing port and bridges incoming gRPC connections transparently — no changes to gRPC clients or servers.

```
Provider (NAT)                    Relay (EC2 / public)           Consumer (NAT)
  private IP                        public IP                      private IP
      │                                  │                              │
      │── REGISTER did:mesh:...──────►  :7000 (control)               │
      │◄── OK 50143 ─────────────────── │                              │
      │                                  │◄── gRPC connect ────────────│
      │◄── CONNECT {id} ─────────────── │                              │
      │── DATA {id} ────────────────►  :7001 (data)                   │
      │                          pipe ←─┤─► consumer                  │
      │◄────────── gRPC traffic ────────┼──────────────────────────────│
```

## Architecture

### Ports

| Port | Direction | Purpose |
|------|-----------|---------|
| `7000` (CONTROL_PORT) | Provider → relay | Persistent control channel; carries REGISTER/OK/CONNECT/PING messages |
| `7001` (DATA_PORT) | Provider → relay | Short-lived data channels, one per active consumer connection |
| `50100–50199` | Consumer → relay | Consumer-facing gRPC — one port per registered provider |

### Port assignment

Provider ports are **deterministic**: the relay runs FNV-32a over the provider DID and maps the result into `[PORT_RANGE_START, PORT_RANGE_START + PORT_RANGE_SIZE)`. This means:

- The provider can compute its public address *before* connecting (useful for Agent Card pre-registration).
- Re-connections always land on the same port.
- No coordination service needed.

The TypeScript helper `computeRelayPort(did)` mirrors the Go implementation exactly.

### Control protocol (text, newline-delimited)

```
Provider → relay (control port 7000):
  REGISTER <did>\n           — register; relay responds OK or ERR
  PING\n                     — keepalive (sent every 30 s by default)

Relay → provider:
  OK <port>\n                — assigned consumer-facing port
  ERR <reason>\n             — registration failed
  CONNECT <connID>\n         — relay asks provider to open a data channel
```

### Data channel protocol

Each time a consumer connects, the relay sends `CONNECT {id}` on the control channel. The provider then opens a *new* TCP connection to DATA_PORT and sends `DATA {id}\n`. The relay pairs the two connections and pipes bidirectionally with no further framing — raw TCP, transparent to gRPC.

## Quick start

### 1. Deploy the relay on your EC2

Add to `.env`:

```env
RELAY_PUBLIC_HOST=<your-ec2-public-ip-or-dns>
```

Start all services:

```bash
docker compose up -d relay
```

Open EC2 security group inbound rules:

| Port range | Protocol | Source |
|------------|----------|--------|
| 7000–7001  | TCP | Provider IPs (or 0.0.0.0/0) |
| 50100–50199 | TCP | Consumer IPs (or 0.0.0.0/0) |

### 2. Provider: connect to the relay

```typescript
import { startRelayTunnel, computeRelayPort } from '@mesh-protocol/sdk';

const RELAY_HOST = 'ec2-54-x-x-x.compute.amazonaws.com';
const MY_DID     = 'did:mesh:agent:my-provider';
const GRPC_PORT  = 50051; // local gRPC server port

// Optional: pre-compute the address before connecting
const precomputedPort = computeRelayPort(MY_DID);
console.log(`will be reachable at ${RELAY_HOST}:${precomputedPort}`);

// Start the tunnel
const tunnel = await startRelayTunnel({
  relayHost:      RELAY_HOST,
  agentDID:       MY_DID,
  localGrpcPort:  GRPC_PORT,
  onDisconnect:   (err) => console.error('relay disconnected', err),
});

console.log('relay tunnel active:', tunnel.grpcAddress);
// → "ec2-54-x-x-x.compute.amazonaws.com:50143"

// Register Agent Card with the relay address
await meshClient.register({
  // ...
  spec: {
    endpoints: {
      control_plane: { nats_subject: 'mesh.agents.my-provider' },
      data_plane:    { grpc: tunnel.grpcAddress },  // ← relay address
    },
    // ...
  },
});

// On shutdown
tunnel.close();
```

### 3. Consumer: no changes

Consumers connect to the address from the match result as usual:

```typescript
const match = await meshClient.request({ ... });
// match.dataPlane.grpc === "ec2-54-x-x-x.compute.amazonaws.com:50143"

const client = createDataPlaneClient(match.dataPlane.grpc, { insecure: true });
```

## Configuration reference

| Env var | Default | Description |
|---------|---------|-------------|
| `PUBLIC_HOST` | `localhost` | Hostname or IP included in `OK <port>` responses and logs |
| `CONTROL_PORT` | `7000` | Provider control channel |
| `DATA_PORT` | `7001` | Provider data channels |
| `PORT_RANGE_START` | `50100` | First port in the consumer pool |
| `PORT_RANGE_SIZE` | `100` | Number of ports (max concurrent providers) |

## Scaling considerations

The relay is stateful per-provider connection and runs as a single process. For the MVP this is fine. Future options when scale matters:

- **Multiple relay instances** behind a load balancer with sticky sessions keyed by provider DID.
- **NATS-based relay** (no extra infra, lower throughput ceiling) — see architecture discussion in `SPECS.md`.
- **Cloudflare Tunnel / Tailscale** as managed alternatives if operational simplicity outweighs cost.

## Security notes

- The relay is a transparent TCP proxy. It does not inspect or decrypt gRPC traffic.
- TLS between consumer and provider passes through unchanged — the relay sees ciphertext only.
- The relay does not authenticate providers. In a production deployment, restrict CONTROL_PORT and DATA_PORT to known CIDR blocks, or add a shared secret to the `REGISTER` handshake (planned for Phase 6 security hardening).
- Consumer ports (`50100–50199`) should be firewalled to expected consumer networks where possible.
