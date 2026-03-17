import test from "node:test";
import assert from "node:assert/strict";
import { parseGrpcEndpoint, createServerCredentials } from "../shared/dataplane.js";

test("parseGrpcEndpoint remove prefix grpc://", () => {
  assert.equal(parseGrpcEndpoint("grpc://127.0.0.1:50051"), "127.0.0.1:50051");
});

test("parseGrpcEndpoint remove prefix grpcs://", () => {
  assert.equal(parseGrpcEndpoint("grpcs://mesh.local:443"), "mesh.local:443");
});

test("parseGrpcEndpoint falha para endpoint vazio", () => {
  assert.throws(() => parseGrpcEndpoint(""), /gRPC endpoint is empty/);
});

test("createServerCredentials suporta modo insecure", () => {
  const creds = createServerCredentials({ insecure: true });
  assert.ok(creds);
});

test("createServerCredentials falha sem cert/key quando TLS ativo", () => {
  assert.throws(
    () => createServerCredentials({ insecure: false }),
    /TLS enabled but server cert\/key files are missing/
  );
});
