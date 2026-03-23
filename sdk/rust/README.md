# Mesh Protocol — Rust SDK

A Rust SDK for building agents on the Mesh Protocol: an open, peer-to-peer capability-exchange layer where AI agents discover each other, negotiate sessions through a NATS control plane, and exchange data over direct gRPC connections (DataPlane).

## Crate Overview

| Crate | Description |
|---|---|
| `mesh-types` | Core data types: `AgentCard`, `MatchOrReject`, CloudEvent payloads |
| `mesh-session` | HMAC-SHA256 session token issuance/validation · optional `enterprise` feature (X25519 + AES-GCM) |
| `mesh-client` | Control-plane client: Registry HTTP API + NATS `request/listen/heartbeat` |
| `mesh-dataplane` | gRPC DataPlane server + consumer client (`Handshake → Transfer → Result`) |
| `mesh-relay` | NAT-traversal relay tunnel client |
| `mesh-proto` | Generated protobuf/tonic bindings (built via `build.rs` + `protoc`) |
| `mesh-sdk` | Façade re-export of the full SDK |

## Quick Start

Add to `Cargo.toml`:

```toml
[dependencies]
mesh-sdk = { path = "sdk/rust/mesh-sdk" }
mesh-session = { path = "sdk/rust/mesh-session" }
```

For enterprise E2E crypto:

```toml
mesh-session = { path = "sdk/rust/mesh-session", features = ["enterprise"] }
```

### Issuing and Validating Session Tokens (Community)

```rust
use mesh_session::{issue_simple_token, validate_simple_token};

let secret = b"shared-secret";
let token = issue_simple_token(secret, "session-id", "did:consumer", "did:provider");

assert!(validate_simple_token(&token, secret, "session-id", "did:consumer", "did:provider"));
```

### Enterprise E2E Crypto (X25519 + AES-256-GCM)

```rust
// Requires: features = ["enterprise"]
use mesh_session::enterprise::enterprise::{StaticKeyPair, EphemeralKeyPair, aes_gcm_encrypt, aes_gcm_decrypt};

// Provider generates a long-lived key pair
let provider = StaticKeyPair::generate();

// Consumer generates an ephemeral keypair per session
let consumer = EphemeralKeyPair::generate();
let consumer_pub = consumer.public;

// Shared secret via ECDH
let shared = provider.diffie_hellman(&consumer_pub);

// Encrypt / decrypt with AES-256-GCM
let nonce = [0u8; 12]; // use a random nonce per message in production
let ct = aes_gcm_encrypt(&shared, &nonce, b"hello", b"session-aad").unwrap();
let pt = aes_gcm_decrypt(&shared, &nonce, &ct, b"session-aad").unwrap();
assert_eq!(pt, b"hello");
```

### Control Plane (NATS + Registry)

```rust
use mesh_client::{MeshClient, MeshClientConfig, RequestOptions};

let cfg = MeshClientConfig {
    nats_url: "nats://localhost:4222".into(),
    registry_url: "http://localhost:8080".into(),
    did: "did:mesh:agent:my-agent".into(),
    region: Some("us-east-1".into()),
};

let client = MeshClient::new(cfg).await?;

// Discover a provider and request a capability
let result = client
    .request(RequestOptions {
        domain: vec!["finance".into()],
        capability_id: "summarise".into(),
        description: Some("Summarise Q3 report".into()),
        timeout_ms: Some(5_000),
    })
    .await?;
```

### DataPlane (gRPC Provider + Consumer)

**Provider** — start the gRPC server:

```rust
let secret = b"shared-session-secret".to_vec();
mesh_dataplane::serve("0.0.0.0:50051", secret, "did:mesh:agent:provider").await?;
```

**Consumer** — call the provider:

```rust
use uuid::Uuid;
use mesh_session::issue_simple_token;

let secret  = b"shared-session-secret";
let session = Uuid::new_v4().to_string();
let token   = issue_simple_token(secret, &session, "did:consumer", "did:provider");

let mut client = mesh_dataplane::DataPlaneConsumerClient::connect("http://127.0.0.1:50051").await?;
let result = client.call(&session, &token, "did:consumer", b"my payload").await?;
println!("{}", String::from_utf8_lossy(&result));
```

## Prerequisites

- Rust 1.75+
- `protoc` — Protobuf compiler for `mesh-proto` codegen:

```bash
# macOS
brew install protobuf

# Ubuntu / Debian
sudo apt-get install -y protobuf-compiler
```

## Build

```bash
# Build all crates (also runs proto codegen)
cargo build --workspace

# Run the DataPlane E2E example
cargo run -p mesh-dataplane --example e2e

# Run all tests
cargo test --workspace

# Run tests with enterprise crypto
cargo test -p mesh-session --features enterprise
```

## Running the Integration Tests

```bash
cargo test -p mesh-dataplane --test integration_test
```

## Architecture

```
Control Plane (NATS / CloudEvents)
  ┌─────────────┐        ┌──────────────┐
  │  Consumer   │──────▶│  Matcher/    │
  │  Agent      │◀──────│  Registry    │
  └──────┬──────┘        └──────────────┘
         │  match (session_id + token)
         ▼
Data Plane (gRPC, peer-to-peer)
  ┌─────────────┐  Handshake  ┌──────────────┐
  │  Consumer   │────────────▶│  Provider    │
  │  Client     │  Transfer   │  Server      │
  │             │────────────▶│              │
  │             │  Result     │              │
  │             │◀────────────│              │
  └─────────────┘             └──────────────┘
```

## Migration from the TypeScript SDK

| TypeScript | Rust |
|---|---|
| `MeshClient.request(opts)` | `MeshClient::request(opts).await` |
| `DataPlaneConsumerClient.call({ sessionId, sessionToken, payload })` | `client.call(session_id, token, consumer_did, payload).await` |
| `issueSimpleToken(secret, id, cons, prov)` | `mesh_session::issue_simple_token(secret, id, cons, prov)` |
| `validateSimpleToken(token, secret, id, cons, prov)` | `mesh_session::validate_simple_token(token, secret, id, cons, prov)` |
| `AgentCard` / `CapabilityMatchData` | `mesh_types::AgentCard` / `mesh_types::CapabilityMatchData` |

Key differences:
- Rust session token functions take `&[u8]` for the secret (not a string).
- `DataPlaneConsumerClient::call` requires `consumer_did` to be passed explicitly (matching the HMAC token computation).
- Enterprise crypto is behind the `enterprise` feature flag; the TS SDK exposes it through a separate package.

## Security Notes

- Session tokens are HMAC-SHA256 over `session_id|consumer_did|provider_did`. The shared `secret` must be securely distributed (e.g., via a secrets manager or the Matching Service).
- Tokens are validated using constant-time comparison (`subtle::ConstantTimeEq`) to prevent timing attacks.
- The `enterprise` feature replaces HMAC tokens with X25519 ECDH + AES-256-GCM authenticated encryption.
- Never reuse a nonce with the same key in AES-GCM; use a random 12-byte nonce per message.
- TLS is not configured in the default examples — add `ClientTlsConfig` / `ServerTlsConfig` via tonic for production use.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

