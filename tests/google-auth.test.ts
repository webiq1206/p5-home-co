import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APPROVED_SIGN_IN_DOMAINS,
  buildAuthorizeUrl,
  checkIdentity,
  decodeIdToken,
  domainOf,
  isApprovedDomain,
  isRejection,
} from "../app/lib/google-auth.ts";

/** Build an unsigned id_token payload the way Google encodes one. */
function idToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
}

// --- Who is allowed in ------------------------------------------------------

test("all six P5 brand domains are approved", () => {
  for (const d of ["p5homeco.com", "boiseconstruction.co", "boiseremodeling.co",
                   "boisehandyman.co", "boiseadu.co", "boisecabinet.co"]) {
    assert.ok((APPROVED_SIGN_IN_DOMAINS as readonly string[]).includes(d), `${d} missing`);
    assert.equal(isApprovedDomain(`someone@${d}`), true);
  }
});

test("outside domains are refused, including near-misses", () => {
  for (const email of [
    "someone@gmail.com",
    "someone@timberandlove.com",
    // Not a subdomain match: evil.com controls this address, not P5.
    "someone@p5homeco.com.evil.com",
    "someone@notp5homeco.com",
  ]) {
    assert.equal(isApprovedDomain(email), false, `${email} must be refused`);
  }
});

test("domain matching is case-insensitive", () => {
  assert.equal(isApprovedDomain("Someone@P5HomeCo.COM"), true);
});

test("malformed addresses have no domain and are refused", () => {
  for (const bad of ["nope", "@p5homeco.com", "someone@", ""]) {
    assert.equal(domainOf(bad), null, `${bad} should have no domain`);
    assert.equal(isApprovedDomain(bad), false);
  }
});

test("an address with multiple @ resolves on the last one", () => {
  assert.equal(domainOf("weird@name@p5homeco.com"), "p5homeco.com");
});

// --- Identity token ---------------------------------------------------------

test("a well-formed token decodes to the identity", () => {
  const result = decodeIdToken(
    idToken({ email: "Hello@P5HomeCo.com", email_verified: true, name: "Client Services", hd: "p5homeco.com" }),
  );
  assert.ok(!isRejection(result));
  if (isRejection(result)) return;
  assert.equal(result.email, "hello@p5homeco.com", "email is lowercased");
  assert.equal(result.emailVerified, true);
  assert.equal(result.name, "Client Services");
});

test("email_verified is accepted as boolean or string, since Google sends both", () => {
  for (const value of [true, "true"]) {
    const r = decodeIdToken(idToken({ email: "a@p5homeco.com", email_verified: value }));
    assert.ok(!isRejection(r) && r.emailVerified === true);
  }
  const no = decodeIdToken(idToken({ email: "a@p5homeco.com", email_verified: false }));
  assert.ok(!isRejection(no) && no.emailVerified === false);
});

test("malformed tokens are rejected rather than half-parsed", () => {
  for (const bad of ["", "abc", "a.b", "a.b.c.d", "not.base64.here"]) {
    assert.ok(isRejection(decodeIdToken(bad)), `${bad} should be rejected`);
  }
});

test("a token with no email is rejected", () => {
  assert.ok(isRejection(decodeIdToken(idToken({ email_verified: true }))));
});

// --- The access decision ----------------------------------------------------

test("a verified P5 address passes the identity check", () => {
  const id = decodeIdToken(idToken({ email: "hello@p5homeco.com", email_verified: true }));
  assert.ok(!isRejection(id));
  if (isRejection(id)) return;
  assert.equal(checkIdentity(id), null);
});

test("an unverified email is refused even on an approved domain", () => {
  const id = decodeIdToken(idToken({ email: "hello@p5homeco.com", email_verified: false }));
  assert.ok(!isRejection(id));
  if (isRejection(id)) return;
  assert.match(checkIdentity(id) ?? "", /not verified its email/);
});

test("a verified address on an outside domain is refused", () => {
  const id = decodeIdToken(idToken({ email: "someone@gmail.com", email_verified: true }));
  assert.ok(!isRejection(id));
  if (isRejection(id)) return;
  assert.match(checkIdentity(id) ?? "", /P5 company account/);
});

// --- The authorize URL ------------------------------------------------------

test("the authorize URL carries state, nonce, and only identity scopes", () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: "client-123",
      redirectUri: "https://p5homeco.com/api/auth/google/callback",
      state: "st",
      nonce: "no",
    }),
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("nonce"), "no");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("prompt"), "select_account");

  const scopes = (url.searchParams.get("scope") ?? "").split(" ");
  assert.deepEqual(scopes.sort(), ["email", "openid", "profile"]);
  // No mail or calendar access: sign-in should not be able to read anything.
  assert.ok(!scopes.some((s) => /gmail|calendar|drive/.test(s)));
});
