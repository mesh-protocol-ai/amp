import test from "node:test";
import assert from "node:assert/strict";
import { parseGrpcEndpoint, createServerCredentials } from "../dist/dataplane/grpc.js";

test("parseGrpcEndpoint remove prefix grpc://", () => {
  assert.equal(parseGrpcEndpoint("grpc://127.0.0.1:50051"), "127.0.0.1:50051");
});

test("parseGrpcEndpoint remove prefix grpcs://", () => {
  assert.equal(parseGrpcEndpoint("grpcs://mesh.local:443"), "mesh.local:443");
});

test("parseGrpcEndpoint returns as-is when no scheme", () => {
  assert.equal(parseGrpcEndpoint("127.0.0.1:50051"), "127.0.0.1:50051");
});

test("parseGrpcEndpoint throws for empty endpoint", () => {
  assert.throws(() => parseGrpcEndpoint(""), /gRPC endpoint is empty/);
});

test("createServerCredentials supports insecure mode", () => {
  const creds = createServerCredentials({ insecure: true });
  assert.ok(creds);
});

test("createServerCredentials throws when TLS enabled but no cert/key", () => {
  assert.throws(
    () => createServerCredentials({ insecure: false }),
    /TLS enabled but server cert\/key files are missing/
  );
});
