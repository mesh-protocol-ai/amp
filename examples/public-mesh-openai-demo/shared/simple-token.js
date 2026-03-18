import crypto from "node:crypto";

/**
 * Validate a Community (OPEN) session token: HMAC-SHA256(secret, session_id|consumer_did|provider_did).
 * Token must be base64url-encoded. Returns true if valid.
 */
export function validateSimpleToken(tokenString, secret, sessionId, consumerDid, providerDid) {
  if (!tokenString || !secret || !sessionId || !consumerDid || !providerDid) return false;
  const payload = `${sessionId}|${consumerDid}|${providerDid}`;
  const expected = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(payload, "utf8").digest("base64url");
  const token = String(tokenString).trim();
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(expected, "utf8"));
}
