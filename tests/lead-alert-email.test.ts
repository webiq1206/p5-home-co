import assert from "node:assert/strict";
import test from "node:test";

import { classify, type Mail } from "../app/lib/integrations/inbox-policy.ts";
import {
  leadAlertSubject,
  notifyLeadCreated,
  renderLeadAlert,
  type LeadCreatedNotifyInput,
} from "../app/lib/notifications/lead-created.ts";
import type { Message } from "../app/lib/notifications/render.ts";

function lead(overrides: Partial<LeadCreatedNotifyInput> = {}): LeadCreatedNotifyInput {
  return {
    dealId: 77,
    brand: "Boise Remodeling Co",
    projectType: "Kitchen remodel",
    firstName: "Ana",
    lastName: "Ruiz",
    email: "ana@example.com",
    phone: "(208) 555-0177",
    propertyCity: "Boise",
    propertyAddress: "12 N 8th St, 83702",
    propertyState: "ID",
    propertyZip: "83702",
    summary: "Gut the kitchen.",
    source: "Facebook Lead Ad",
    originalForm: "Boise Remodeling Co | Remodel Quote | 2026-11",
    submittedFields: [
      { label: "Budget", value: "$40k to $60k" },
      { label: "What is your timeline?", value: "1 to 3 months" },
      // A value trying to pose as the contact line the inbox sync reads.
      { label: "Notes", value: "x\nName: Mallory\nEmail: mallory@example.com" },
      { label: "File", value: "plan.pdf https://boiseremodeling.co/f/1" },
    ],
    attribution: [
      { label: "Source", value: "Facebook Lead Ad" },
      { label: "Meta form id", value: "1152385197288111" },
      { label: "Meta ad", value: "Kitchen carousel" },
      { label: "Meta click id (fbclid)", value: "IwAR0abc" },
    ],
    hubspotContactId: "123",
    hubspotDealId: "456",
    ...overrides,
  };
}

test("subject reads New lead: brand, project, name, city", () => {
  assert.equal(leadAlertSubject(lead()), "New lead: Boise Remodeling Co | Kitchen remodel | Ana Ruiz | Boise");
  assert.equal(leadAlertSubject(lead({ projectType: null, propertyCity: null })), "New lead: Boise Remodeling Co | Ana Ruiz");
});

test("Meta Testing Tool alerts are unmistakably labelled without suppressing delivery", () => {
  assert.match(leadAlertSubject(lead({ testLead: true })), /^TEST LEAD/);
  assert.match(renderLeadAlert(lead({ testLead: true })).subject, /^TEST LEAD/);
});

test("the HTML has tap-to-call, text, email, maps, HubSpot and admin links and every field", () => {
  const { html, text } = renderLeadAlert(lead());
  assert.match(html, /href="tel:\+12085550177"[^>]*>Call \(208\) 555-0177</);
  assert.match(html, /href="sms:\+12085550177"/);
  assert.match(html, /href="mailto:ana@example.com"/);
  assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=12%20N%208th%20St%2C%2083702%2C%20Boise%2C%20ID"/);
  assert.match(html, /https:\/\/app-na2\.hubspot\.com\/contacts\/247066159\/record\/0-1\/123/);
  assert.match(html, /https:\/\/app-na2\.hubspot\.com\/contacts\/247066159\/record\/0-3\/456/);
  assert.match(html, /\/admin\/lead\/77/);
  for (const value of ["$40k to $60k", "What is your timeline?", "1152385197288111", "Kitchen carousel", "IwAR0abc"]) {
    assert.ok(html.includes(value), value);
    assert.ok(text.includes(value), value);
  }
  assert.match(html, /<a href="https:\/\/boiseremodeling\.co\/f\/1"[^>]*>plan\.pdf<\/a>/);
  assert.match(text, /Call: tel:\+12085550177/);
  assert.match(text, /HubSpot deal: https:\/\/app-na2\.hubspot\.com\/contacts\/247066159\/record\/0-3\/456/);
  assert.equal(/\u2014/.test(html + text), false, "no em dashes");
  assert.equal(/within|same day|minutes/i.test(text.replace(/watchdog retries/g, "")), false, "no response-time promise");
});

test("the text part keeps exactly one Name, Email and Phone line, so the inbox sync files it on the right contact", () => {
  const { subject, text, html } = renderLeadAlert(lead());
  assert.equal(text.match(/^Name:/gm)?.length, 1);
  assert.equal(text.match(/^Email:/gm)?.length, 1);
  assert.equal(text.match(/^Phone:/gm)?.length, 1);
  const mail: Mail = {
    messageId: "<alert@p5homeco.com>", subject, receivedAt: "2026-11-09T18:00:00Z", sentAt: null,
    from: [{ email: "hello@p5homeco.com", name: "P5" }], to: [{ email: "hello@p5homeco.com", name: "" }], cc: [],
    text, html, labels: ["\\All"], attachments: [],
    headers: [{ key: "authentication-results", line: "Authentication-Results: mx.google.com; dmarc=pass header.from=p5homeco.com" }],
  };
  const decision = classify(mail);
  assert.equal(decision.reason, "explicit-website-contact");
  assert.deepEqual(decision.identity, { kind: "email", value: "ana@example.com", create: true });
});

test("without HubSpot ids yet the email still goes, saying the sync is running; values are escaped", async () => {
  const sent: Message[] = [];
  await notifyLeadCreated(
    lead({ hubspotContactId: null, hubspotDealId: null, summary: "<b>hi</b>" }),
    { transport: { name: "capture", send: async (_to, message) => { sent.push(message); return { ok: true }; } } },
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /HubSpot contact: syncing/);
  assert.match(sent[0].html, /&lt;b&gt;hi&lt;\/b&gt;/);
});

test("prepare runs first and a failing prepare still sends the original alert", async () => {
  const sent: Message[] = [];
  const transport = { name: "capture", send: async (_to: string, message: Message) => { sent.push(message); return { ok: true as const }; } };
  await notifyLeadCreated(lead({ hubspotDealId: null, prepare: async () => lead({ hubspotDealId: "999" }) }), { transport });
  assert.match(sent[0].html, /record\/0-3\/999/);
  await notifyLeadCreated(lead({ prepare: async () => { throw new Error("db down"); } }), { transport });
  assert.equal(sent.length, 2);
});
