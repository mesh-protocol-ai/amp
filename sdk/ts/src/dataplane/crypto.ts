import crypto from "node:crypto";

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

/** OPEN (Community): build a chunk with raw bytes, no encryption. algorithm = "none". */
export function createChunkOpen(
  payload: Buffer,
  sequence = 1,
  isFinal = true
): { ciphertext: Buffer; nonce: Buffer; sequence: number; is_final: boolean; algorithm: string } {
  return {
    ciphertext: payload,
    nonce: Buffer.alloc(0),
    sequence,
    is_final: isFinal,
    algorithm: "none",
  };
}
