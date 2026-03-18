import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createChunkOpen,
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
} from "../shared/security.js";
import { validateSimpleToken } from "../shared/simple-token.js";

test("Ed25519: assinatura e verificação funcionam", () => {
  const { privateKey, publicKey } = generateEd25519KeyPair();
  const payload = Buffer.from("mesh-security-payload", "utf8");
  const signature = signEd25519(privateKey, payload);
  assert.equal(verifyEd25519(publicKey, payload, signature), true);
});

test("Ed25519: assinatura inválida com payload alterado", () => {
  const { privateKey, publicKey } = generateEd25519KeyPair();
  const payload = Buffer.from("payload-original", "utf8");
  const signature = signEd25519(privateKey, payload);
  assert.equal(verifyEd25519(publicKey, Buffer.from("payload-alterado", "utf8"), signature), false);
});

test("createChunkOpen: payload direto, algorithm none", () => {
  const payload = Buffer.from(JSON.stringify({ description: "2+2" }), "utf8");
  const chunk = createChunkOpen(payload, 1, true);
  assert.equal(chunk.algorithm, "none");
  assert.deepEqual(Buffer.from(chunk.ciphertext), payload);
  assert.equal(chunk.sequence, 1);
  assert.equal(chunk.is_final, true);
});

test("validateSimpleToken: token válido", () => {
  const secret = "test-secret";
  const sessionId = "s1";
  const consumerDid = "did:mesh:agent:c";
  const providerDid = "did:mesh:agent:p";
  const payload = `${sessionId}|${consumerDid}|${providerDid}`;
  const expected = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(payload, "utf8").digest("base64url");
  assert.equal(validateSimpleToken(expected, secret, sessionId, consumerDid, providerDid), true);
});

test("validateSimpleToken: token inválido", () => {
  assert.equal(validateSimpleToken("wrong", "secret", "s1", "did:c", "did:p"), false);
});
