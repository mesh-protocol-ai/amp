import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildHandshakePayload,
  createX25519Ephemeral,
  decryptChunk,
  deriveSessionKey,
  encryptChunk,
  exportX25519PublicKeyBase64,
  generateEd25519KeyPair,
  importX25519PublicKeyBase64,
  signEd25519,
  verifyEd25519,
} from "../shared/security.js";

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

test("X25519+HKDF: ambos lados derivam mesma session key", () => {
  const consumerEph = createX25519Ephemeral();
  const providerEph = createX25519Ephemeral();
  const consumerPub = providerEph.publicKey.export({ format: "der", type: "spki" });
  const providerPub = consumerEph.publicKey.export({ format: "der", type: "spki" });
  const sessionId = "session-test-123";

  const keyA = deriveSessionKey({
    privateKey: consumerEph.privateKey,
    peerPublicKeyBytes: consumerPub,
    sessionId,
  });
  const keyB = deriveSessionKey({
    privateKey: providerEph.privateKey,
    peerPublicKeyBytes: providerPub,
    sessionId,
  });
  assert.deepEqual(Buffer.from(keyA), Buffer.from(keyB));
});

test("X25519 key agreement: export/import base64 preserva material de chave", () => {
  const pairA = createX25519Ephemeral();
  const pairB = createX25519Ephemeral();
  const b64 = exportX25519PublicKeyBase64(pairB.publicKey);
  const imported = importX25519PublicKeyBase64(b64);
  const s1 = crypto.diffieHellman({ privateKey: pairA.privateKey, publicKey: pairB.publicKey });
  const s2 = crypto.diffieHellman({ privateKey: pairA.privateKey, publicKey: imported });
  assert.deepEqual(s1, s2);
});

test("AES-256-GCM: encrypt/decrypt round-trip", () => {
  const key = crypto.randomBytes(32);
  const plaintext = Buffer.from(JSON.stringify({ hello: "mesh" }), "utf8");
  const chunk = encryptChunk({ key, sequence: 1, payloadBuffer: plaintext });
  const decoded = decryptChunk({ key, chunk });
  assert.equal(decoded.toString("utf8"), plaintext.toString("utf8"));
});

test("AES-256-GCM: falha ao decriptar com chave errada", () => {
  const key = crypto.randomBytes(32);
  const wrongKey = crypto.randomBytes(32);
  const chunk = encryptChunk({
    key,
    sequence: 1,
    payloadBuffer: Buffer.from("secret", "utf8"),
  });
  assert.throws(() => decryptChunk({ key: wrongKey, chunk }));
});

test("Handshake payload: formato determinístico", () => {
  const payload = buildHandshakePayload("s1", "did:mesh:agent:a", Buffer.from([1, 2, 3]));
  assert.equal(payload.toString("utf8"), "s1:did:mesh:agent:a:AQID");
});
