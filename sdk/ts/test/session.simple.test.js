import test from "node:test";
import assert from "node:assert/strict";
import { issueSimpleToken, validateSimpleToken } from "../dist/session/simple.js";

test("issueSimpleToken returns non-empty token", () => {
  const token = issueSimpleToken("secret", "s1", "did:mesh:agent:c", "did:mesh:agent:p");
  assert.ok(token.length > 0);
});

test("issueSimpleToken same input yields same token", () => {
  const t1 = issueSimpleToken("secret", "s1", "did:c", "did:p");
  const t2 = issueSimpleToken("secret", "s1", "did:c", "did:p");
  assert.equal(t1, t2);
});

test("issueSimpleToken throws for empty secret", () => {
  assert.throws(
    () => issueSimpleToken("", "s1", "did:c", "did:p"),
    /missing secret/
  );
});

test("issueSimpleToken throws for empty sessionId", () => {
  assert.throws(
    () => issueSimpleToken("secret", "", "did:c", "did:p"),
    /missing session_id/
  );
});

test("validateSimpleToken: valid token returns true", () => {
  const token = issueSimpleToken("secret", "s1", "did:mesh:agent:c", "did:mesh:agent:p");
  assert.equal(validateSimpleToken(token, "secret", "s1", "did:mesh:agent:c", "did:mesh:agent:p"), true);
});

test("validateSimpleToken: invalid token returns false", () => {
  assert.equal(validateSimpleToken("wrong", "secret", "s1", "did:c", "did:p"), false);
});

test("validateSimpleToken: empty token returns false", () => {
  assert.equal(validateSimpleToken("", "secret", "s1", "did:c", "did:p"), false);
});

test("validateSimpleToken: wrong secret returns false", () => {
  const token = issueSimpleToken("secret1", "s1", "did:c", "did:p");
  assert.equal(validateSimpleToken(token, "secret2", "s1", "did:c", "did:p"), false);
});
