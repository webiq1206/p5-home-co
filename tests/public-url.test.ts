import { test } from "node:test";
import assert from "node:assert/strict";

import { appUrl, isBindAddress, publicOrigin } from "../app/lib/public-url.ts";

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

test("bind addresses are recognised", () => {
  for (const h of ["0.0.0.0:3000", "127.0.0.1", "[::]:3000", "[::1]:3000"]) {
    assert.equal(isBindAddress(h), true, `${h} is a bind address`);
  }
  for (const h of ["p5homeco.com", "localhost:3000", "p5-home-co.replit.app"]) {
    assert.equal(isBindAddress(h), false, `${h} is reachable`);
  }
});

test("the public origin comes from the forwarding headers, not the bind address", () => {
  // The live bug: Replit binds to 0.0.0.0:3000, so every absolute redirect
  // built from request.url sent the browser to https://0.0.0.0:3000.
  assert.equal(
    publicOrigin(
      req("http://0.0.0.0:3000/api/auth/google", {
        "x-forwarded-host": "p5homeco.com",
        "x-forwarded-proto": "https",
      }),
    ),
    "https://p5homeco.com",
  );
});

test("a proxy chain uses the first hop", () => {
  assert.equal(
    publicOrigin(
      req("http://0.0.0.0:3000/x", {
        "x-forwarded-host": "p5homeco.com, internal.replit, other",
        "x-forwarded-proto": "https, http",
      }),
    ),
    "https://p5homeco.com",
  );
});

test("a forwarded host that is itself a bind address is ignored", () => {
  assert.equal(
    publicOrigin(req("http://0.0.0.0:3000/x", { "x-forwarded-host": "0.0.0.0:3000", host: "p5homeco.com" })),
    "https://p5homeco.com",
  );
});

test("localhost keeps http for local development", () => {
  assert.equal(publicOrigin(req("http://localhost:3000/x", { host: "localhost:3000" })), "http://localhost:3000");
});

test("with nothing usable it throws rather than returning a dead address", () => {
  assert.throws(
    () => publicOrigin(req("http://0.0.0.0:3000/x", { host: "0.0.0.0:3000" })),
    /public URL/,
  );
});

test("appUrl builds absolute URLs on the public origin", () => {
  assert.equal(
    appUrl(req("http://0.0.0.0:3000/x", { "x-forwarded-host": "p5homeco.com" }), "/admin"),
    "https://p5homeco.com/admin",
  );
  assert.equal(
    appUrl(req("http://0.0.0.0:3000/x", { "x-forwarded-host": "p5homeco.com" }), "/admin/login?error=state"),
    "https://p5homeco.com/admin/login?error=state",
  );
});

test("appUrl degrades to a relative path rather than a dead absolute one", () => {
  // A relative redirect still lands the browser in the right place; an
  // absolute one built from 0.0.0.0 does not.
  const result = appUrl(req("http://0.0.0.0:3000/x", { host: "0.0.0.0:3000" }), "/admin/login");
  assert.equal(result, "/admin/login");
  assert.ok(!result.includes("0.0.0.0"));
});
