import { test } from "node:test";
import assert from "node:assert/strict";
import { getSmtpConfig, assertSmtpAccepted } from "../app/lib/notifications/smtp-config.ts";
import { consoleTransport } from "../app/lib/notifications/transport.ts";

const credentials = { SMTP_USER: "hello@p5homeco.com", SMTP_PASSWORD: "test-only" };

test("SMTP uses the P5 identity, TLS and bounded connection timeouts", () => {
  const config = getSmtpConfig(credentials);
  assert.equal(config.from, "P5 Home Co <hello@p5homeco.com>");
  assert.equal(config.replyTo, "hello@p5homeco.com");
  assert.equal(config.options.secure, true);
  assert.equal(config.options.connectionTimeout, 15000);
  const starttls = getSmtpConfig({ ...credentials, SMTP_PORT: "587" });
  assert.equal(starttls.options.secure, false);
  assert.equal(starttls.options.requireTLS, true);
});

test("SMTP rejects missing credentials, invalid ports and unaligned sender identities", () => {
  assert.throws(() => getSmtpConfig({}));
  for (const SMTP_PORT of ["0", "65536", "abc", "465.5"]) assert.throws(() => getSmtpConfig({ ...credentials, SMTP_PORT }));
  for (const SMTP_FROM of ["hello@gmail.com", "a@p5homeco.com,b@p5homeco.com", "a@p5homeco.com\r\nBcc: b@example.com", "a@@p5homeco.com"]) {
    assert.throws(() => getSmtpConfig({ ...credentials, SMTP_FROM }));
  }
});

test("SMTP partial rejection is a failure, not successful delivery", () => {
  assertSmtpAccepted({ accepted: ["test@example.com"], rejected: [] });
  for (const response of [{}, { accepted: [] }, { accepted: ["one@example.com"], rejected: ["two@example.com"] }]) {
    assert.throws(() => assertSmtpAccepted(response));
  }
});

test("logging a message without credentials does not count as a send", async () => {
  const result = await consoleTransport.send("test@example.com", { subject: "Test", text: "Test", html: "<p>Test</p>" });
  assert.equal(result.ok, false);
});
