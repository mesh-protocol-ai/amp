import crypto from "node:crypto";

/**
 * Community (OPEN) session token: HMAC-SHA256(secret, session_id|consumer_did|provider_did), base64url.
 * Aligned with pkg/session/simple.go. See COMMUNITY_VS_ENTERPRISE.md for OPEN vs STANDARD/Enterprise.
 */

/**
 * Issues an opaque HMAC-SHA256 token for the given session and parties.
 * Token = base64url(HMAC-SHA256(secret, sessionId|consumerDid|providerDid)).
 * Used by Community edition (security_level OPEN). Matching services use this to issue tokens;
 * providers use validateSimpleToken to verify the token in the Handshake.
 *
 * @param secret - Shared secret (utf-8 string or Buffer). Must not be empty.
 * @param sessionId - Session identifier.
 * @param consumerDid - Consumer agent DID.
 * @param providerDid - Provider agent DID.
 * @returns Base64url-encoded token string.
 * @throws Error if secret is empty or any of sessionId, consumerDid, providerDid is empty.
 */
export function issueSimpleToken(
  secret: string | Buffer,
  sessionId: string,
  consumerDid: string,
  providerDid: string
): string {
  const secretBuf = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  if (secretBuf.length === 0) {
    throw new Error("invalid session token: missing secret");
  }
  if (!sessionId?.trim() || !consumerDid?.trim() || !providerDid?.trim()) {
    throw new Error("invalid session token: missing session_id, consumer_did or provider_did");
  }
  const payload = `${sessionId}|${consumerDid}|${providerDid}`;
  const mac = crypto.createHmac("sha256", secretBuf).update(payload, "utf8").digest("base64url");
  return mac;
}

/**
 * Validates a Community (OPEN) session token: HMAC-SHA256(secret, session_id|consumer_did|provider_did).
 * Uses constant-time comparison. Use this in the data-plane Handshake to verify the token
 * issued by the matching service.
 *
 * @param tokenString - The token string (base64url) received in the Handshake.
 * @param secret - Same shared secret used by the matching service (utf-8 string or Buffer).
 * @param sessionId - Session identifier from the match.
 * @param consumerDid - Consumer agent DID.
 * @param providerDid - Provider agent DID.
 * @returns true if the token is valid; false if invalid or any parameter is empty.
 */
export function validateSimpleToken(
  tokenString: string,
  secret: string | Buffer,
  sessionId: string,
  consumerDid: string,
  providerDid: string
): boolean {
  if (!tokenString || !secret || !sessionId || !consumerDid || !providerDid) {
    return false;
  }
  const secretBuf = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  if (secretBuf.length === 0) {
    return false;
  }
  try {
    const expected = issueSimpleToken(secretBuf, sessionId, consumerDid, providerDid);
    const token = String(tokenString).trim();
    if (token.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}
