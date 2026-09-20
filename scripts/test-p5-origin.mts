import assert from "node:assert/strict";
import { isAllowedEstimatorOrigin } from "../lib/p5/origin.ts";

const saved = { ...process.env };
try {
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.REPLIT_DEV_DOMAIN = "example.replit.dev";
  process.env.REPLIT_DOMAINS = "other.replit.dev";
  const check = (origin: string | null) => isAllowedEstimatorOrigin(origin, "http://internal:5000/api/p5-estimator/scope", "boiseremodeling.co");
  assert.ok(check("https://example.replit.dev"));
  assert.ok(check("https://other.replit.dev"));
  assert.ok(check("https://boiseremodeling.co"));
  assert.ok(check("https://www.boiseremodeling.co"));
  assert.ok(check(null));
  for (const origin of ["null", "https://evil.replit.dev", "https://boiseremodeling.co.evil.test", "http://example.replit.dev"]) assert.equal(check(origin), false);
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(check("https://example.replit.dev"), false);
  assert.ok(check("https://boiseremodeling.co"));
  console.log("P5 origin checks passed");
} finally {
  for (const key of ["NODE_ENV", "REPLIT_DEV_DOMAIN", "REPLIT_DOMAINS"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}