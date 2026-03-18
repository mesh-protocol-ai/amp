import test from "node:test";
import assert from "node:assert/strict";
import {
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
  createChunkOpen,
} from "../dist/dataplane/crypto.js";

test("Ed25519: sign and verify roundtrip", () => {
  const { privateKey, publicKey } = generateEd25519KeyPair();
  const payload = Buffer.from("mesh-security-payload", "utf8");
  const signature = signEd25519(privateKey, payload);
  assert.equal(verifyEd25519(publicKey, payload, signature), true);
});

test("Ed25519: verify fails when payload altered", () => {
  const { privateKey, publicKey } = generateEd25519KeyPair();
  const payload = Buffer.from("payload-original", "utf8");
  const signature = signEd25519(privateKey, payload);
  assert.equal(
    verifyEd25519(publicKey, Buffer.from("payload-altered", "utf8"), signature),
    false
  );
});

test("createChunkOpen: algorithm none, sequence and is_final", () => {
  const payload = Buffer.from(JSON.stringify({ description: "2+2" }), "utf8");
  const chunk = createChunkOpen(payload, 1, true);
  assert.equal(chunk.algorithm, "none");
  assert.deepEqual(Buffer.from(chunk.ciphertext), payload);
  assert.equal(chunk.sequence, 1);
  assert.equal(chunk.is_final, true);
});

test("createChunkOpen: default sequence and isFinal", () => {
  const payload = Buffer.from("hello", "utf8");
  const chunk = createChunkOpen(payload);
  assert.equal(chunk.sequence, 1);
  assert.equal(chunk.is_final, true);
  assert.equal(chunk.algorithm, "none");
});
