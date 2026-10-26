import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PUBLIC_EMAIL } from "../app/publicIdentity.ts";
import { SYNTHETIC_ESTIMATOR_FORM } from "../app/lib/leads/synthetic-qa.ts";
import {
  notifyLeadCreated,
  type LeadCreatedNotifyInput,
} from "../app/lib/notifications/lead-created.ts";
import type { Message } from "../app/lib/notifications/render.ts";
import type { SendResult, Transport } from "../app/lib/notifications/transport.ts";

function lead(overrides: Partial<LeadCreatedNotifyInput> = {}): LeadCreatedNotifyInput {
  return {
    dealId: 42,
    brand: "Boise ADU Co",
    projectType: "Accessory dwelling unit (ADU)",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "(208) 555-0100",
    propertyCity: "Boise",
    propertyAddress: "10 Main St",
    summary: "Detached unit behind the house.",
    source: "Organic Website",
    originalForm: "Quote Landing Page",
    ...overrides,
  };
}

function captureTransport(send: Transport["send"]): { transport: Transport; calls: { to: string; message: Message }[] } {
  const calls: { to: string; message: Message }[] = [];
  return {
    calls,
    transport: {
      name: "capture",
      send: async (to, message) => {
        calls.push({ to, message });
        return send(to, message);
      },
    },
  };
}

test("a created quote emails hello@p5homeco.com even when escalation mail is off", async () => {
  const original = process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
  delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
  const { transport, calls } = captureTransport(async () => ({ ok: true }));
  try {
    await notifyLeadCreated(lead(), { transport });
  } finally {
    if (original === undefined) delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
    else process.env.P5_LEAD_ALERT_EMAILS_ENABLED = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, PUBLIC_EMAIL);
  assert.equal(PUBLIC_EMAIL, "hello@p5homeco.com");
  assert.equal(calls[0].message.subject, "New quote enquiry: Ada Lovelace · Boise ADU Co");
  assert.match(calls[0].message.text, /Project: Accessory dwelling unit \(ADU\)/);
  assert.match(calls[0].message.text, /City: Boise/);
  assert.match(calls[0].message.text, /Address: 10 Main St/);
  assert.match(calls[0].message.text, /Phone: \(208\) 555-0100/);
  assert.match(calls[0].message.text, /Email: ada@example.com/);
  assert.match(calls[0].message.text, /Detached unit behind the house\./);
  assert.match(calls[0].message.text, /Deal id: 42/);
  assert.match(calls[0].message.text, /\/admin\/lead\/42/);
});

test("visitor project type is quoted as submitted, including labels HubSpot cannot store", async () => {
  const { transport, calls } = captureTransport(async () => ({ ok: true }));
  await notifyLeadCreated(lead({
    projectType: "Something else, or I am not sure",
    brand: "P5 Home Co",
    summary: "<script>alert(1)</script>",
  }), { transport });
  assert.equal(calls.length, 1);
  assert.match(calls[0].message.text, /Something else, or I am not sure/);
  assert.match(calls[0].message.html, /&lt;script&gt;/);
});

test("synthetic, failed, and thrown sends do not escape the helper", async () => {
  const synthetic = captureTransport(async () => ({ ok: true }));
  await notifyLeadCreated(lead({ originalForm: SYNTHETIC_ESTIMATOR_FORM }), { transport: synthetic.transport });
  assert.equal(synthetic.calls.length, 0);

  const failed = captureTransport(async () => ({ ok: false, error: "mailbox full" }));
  await assert.doesNotReject(notifyLeadCreated(lead(), { transport: failed.transport }));
  assert.equal(failed.calls.length, 1);

  const exploded: Transport = {
    name: "explode",
    async send(): Promise<SendResult> {
      throw new Error("smtp down");
    },
  };
  await assert.doesNotReject(notifyLeadCreated(lead(), { transport: exploded }));
});

test("public intake notifies only after a created lead and ignores the escalation flag", () => {
  const source = readFileSync(new URL("../app/api/leads/intake/route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(result\.status === "created"\) \{/);
  assert.match(source, /after\(async \(\) => \{\s*await notifyLeadCreated\(notice\)/);
  assert.equal(source.includes("P5_LEAD_ALERT_EMAILS_ENABLED"), false);
});

test("short request notifies only after a created lead and ignores the escalation flag", () => {
  const source = readFileSync(new URL("../app/api/leads/short-request/route.ts", import.meta.url), "utf8");
  assert.match(source, /const created = result\.status === "created"/);
  assert.match(source, /if \(created\) \{/);
  assert.match(source, /dealId: result\.dealId/);
  assert.match(source, /projectType: project/);
  assert.match(source, /propertyCity: null/);
  assert.match(source, /propertyAddress: null/);
  assert.match(source, /source: resolvedSource/);
  assert.match(source, /originalForm: formName/);
  assert.match(source, /after\(async \(\) => \{\s*await notifyLeadCreated\(notice\)/);
  assert.equal(source.includes("P5_LEAD_ALERT_EMAILS_ENABLED"), false);
  assert.equal((source.match(/await notifyLeadCreated\(/g) ?? []).length, 1);
});
