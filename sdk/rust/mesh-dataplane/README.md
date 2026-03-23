Mesh Protocol DataPlane (Rust)

This crate provides a minimal DataPlane server and consumer client implementing the `amp.dataplane.v1.DataPlane` gRPC service.

Quick start (local, example):

1. Generate protobuf sources (requires `protoc`, Rust toolchain):

```sh
cd sdk/rust
cargo build -p mesh-proto
```

2. Build and run provider example (starts server on 127.0.0.1:50051):

```sh
cargo run -p mesh-dataplane --example provider
```

3. In another terminal, run consumer example to perform Handshake → Transfer → Result:

```sh
cargo run -p mesh-dataplane --example consumer
```

Notes:
- This is an MVP reference implementation. It uses an in-memory session store and accepts plaintext chunks (`algorithm: "none"`).
- For production use, enable TLS on gRPC transport, implement E2E encryption (enterprise feature), and persist sessions securely.
