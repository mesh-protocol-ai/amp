import crypto from "node:crypto";

const INFO_LABEL = Buffer.from("amp-data-plane-v1", "utf8");

export function generateEd25519KeyPair(): crypto.KeyPairKeyObjectResult {
  return crypto.generateKeyPairSync("ed25519");
}

export function loadEd25519PrivateKeyFromBase64(pkcs8Base64: string): crypto.KeyObject {
  const der = Buffer.from(pkcs8Base64, "base64");
  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function exportEd25519PublicKeyBase64(publicKey: crypto.KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

export function publicKeyFromBase64(spkiBase64: string): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki" });
}

export function signEd25519(privateKey: crypto.KeyObject, payload: Buffer): Buffer {
  return crypto.sign(null, payload, privateKey);
}

export function verifyEd25519(publicKey: crypto.KeyObject, payload: Buffer, signature: Buffer): boolean {
  return crypto.verify(null, payload, publicKey, signature);
}

export function createX25519Ephemeral(): crypto.KeyPairKeyObjectResult {
  return crypto.generateKeyPairSync("x25519");
}

export function exportX25519PublicKeyBytes(publicKey: crypto.KeyObject): Buffer {
  return publicKey.export({ format: "der", type: "spki" }) as Buffer;
}

export function exportX25519PublicKeyBase64(publicKey: crypto.KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

export function importX25519PublicKeyBytes(spkiDerBytes: Buffer): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.from(spkiDerBytes), format: "der", type: "spki" });
}

export function importX25519PublicKeyBase64(spkiBase64: string): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki" });
}

export function deriveSessionKey(input: { privateKey: crypto.KeyObject; peerPublicKeyBytes: Buffer; sessionId: string }): Buffer {
  const peerPublicKey = importX25519PublicKeyBytes(input.peerPublicKeyBytes);
  const shared = crypto.diffieHellman({ privateKey: input.privateKey, publicKey: peerPublicKey });
  const derived = crypto.hkdfSync("sha384", shared, Buffer.from(input.sessionId, "utf8"), INFO_LABEL, 32);
  return Buffer.from(derived);
}

export function encryptChunk(input: { key: Buffer; sequence: number; payloadBuffer: Buffer }) {
  const nonce = crypto.randomBytes(12);
  const aad = Buffer.from(String(input.sequence), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", input.key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(input.payloadBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ciphertext, tag]),
    nonce,
    sequence: input.sequence,
    is_final: true,
    algorithm: "AES-256-GCM",
  };
}

export function decryptChunk(input: { key: Buffer; chunk: { ciphertext: Buffer; nonce: Buffer; sequence: number } }): Buffer {
  const payload = Buffer.from(input.chunk.ciphertext);
  if (payload.length < 16) {
    throw new Error("ciphertext too short");
  }
  const ciphertext = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  const aad = Buffer.from(String(input.chunk.sequence || 0), "utf8");
  const decipher = crypto.createDecipheriv("aes-256-gcm", input.key, Buffer.from(input.chunk.nonce));
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function buildHandshakePayload(sessionId: string, did: string, ephPubBytes: Buffer): Buffer {
  return Buffer.from(`${sessionId}:${did}:${Buffer.from(ephPubBytes).toString("base64")}`, "utf8");
}
