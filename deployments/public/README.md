# AMP public deployment (meshprotocol.dev)

One VM runs: NATS, Registry, Matching, Postgres, Caddy (TLS).

## On the server (after clone)

1. **Create `.env` from the example**
   ```bash
   cd deployments/public
   cp .env.example .env
   nano .env   # set POSTGRES_PASSWORD, NATS_TOKEN, and RELAY_PUBLIC_HOST
   ```

   `RELAY_PUBLIC_HOST` must be the public IP or DNS name of the EC2 instance
   (e.g. `54.x.x.x` or `ec2-54-x-x-x.compute.amazonaws.com`). Provider agents
   use this value as their `data_plane.grpc` address in their Agent Card.

2. **Optional: change domain in Caddyfile**  
   If you use a different domain than `api.meshprotocol.dev`, edit `Caddyfile` and replace the hostname.

3. **Build and start**
   ```bash
   docker compose up -d --build
   ```

4. **Check**
   - Registry: `https://api.meshprotocol.dev` (after DNS points to this host)
   - NATS: `nats://<NATS_TOKEN>@nats.meshprotocol.dev:4222` (use the token from `.env` in your SDK)

5. **Test subdomains and services**
   ```bash
   chmod +x test-services.sh
   ./test-services.sh
   # Or with another domain: ./test-services.sh mydomain.com
   ```
   The script checks: `api.<domain>/health`, `registry.<domain>/health`, NATS TCP on `nats.<domain>:4222`, and `GET /agents`.

## SDK usage

```bash
export NATS_URL="nats://SEU_NATS_TOKEN@nats.meshprotocol.dev:4222"
export REGISTRY_URL="https://api.meshprotocol.dev"
```

Then use `@meshprotocol/sdk` as in the repo docs.

## Data Plane Relay

The relay service is included in this deployment and solves NAT traversal for
provider agents running behind firewalls.

**EC2 security group — additional inbound rules required:**

| Port range | Protocol | Source | Purpose |
|------------|----------|---------|---------|
| 7000 | TCP | 0.0.0.0/0 | Provider control channel |
| 7001 | TCP | 0.0.0.0/0 | Provider data channels |
| 50100–50199 | TCP | 0.0.0.0/0 | Consumer gRPC connections |

**Provider SDK usage:**

```typescript
import { startRelayTunnel } from '@mesh-protocol/sdk';

const tunnel = await startRelayTunnel({
  relayHost: process.env.RELAY_PUBLIC_HOST!, // same value as .env
  agentDID:  'did:mesh:agent:my-provider',
  localGrpcPort: 50051,
});

// Register Agent Card with the relay address:
await meshClient.register({
  spec: {
    endpoints: {
      control_plane: { nats_subject: 'mesh.agents.my-provider' },
      data_plane:    { grpc: tunnel.grpcAddress }, // e.g. "54.x.x.x:50143"
    },
  },
});
```

See `docs/DATA_PLANE_RELAY.md` for the full protocol and configuration reference.
