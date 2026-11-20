import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { BUSINESS_HOURS } from "../lib/businessHours.ts";
import {
  CONTACT_DESCRIPTION,
  CONTACT_FAQS,
  CONTACT_HOURS,
  CONTACT_LEAD,
  CONTACT_TITLE,
  contactLeadWordCount,
  contactPageSchema,
} from "../app/contact/content.ts";
import { P5_GBP_MAP_EMBED_URL, P5_GBP_PLACE_ID, PUBLIC_ADDRESS, PUBLIC_EMAIL, PUBLIC_PHONE_DISPLAY } from "../app/publicIdentity.ts";
import sitemap from "../app/sitemap.ts";

test("the contact page answers in 40 to 60 words and keeps the title and description in range", () => {
  assert.equal(CONTACT_TITLE, "Contact P5 Home Co | Meridian, Idaho home companies");
  assert.ok(CONTACT_TITLE.length <= 60, String(CONTACT_TITLE.length));
  assert.ok(CONTACT_DESCRIPTION.length > 0 && CONTACT_DESCRIPTION.length <= 155, String(CONTACT_DESCRIPTION.length));
  const words = contactLeadWordCount();
  assert.ok(words >= 40 && words <= 60, String(words));
  // Owner copy rule: no phone number or address in a hero paragraph. Both stay on the page.
  assert.equal(CONTACT_LEAD.includes(PUBLIC_ADDRESS), false);
  assert.equal(CONTACT_LEAD.includes(PUBLIC_PHONE_DISPLAY), false);
  assert.ok(CONTACT_LEAD.includes(PUBLIC_EMAIL));
  assert.equal(CONTACT_LEAD.includes("\u2014") || CONTACT_LEAD.includes("\u2013"), false);
});

test("the contact FAQPage matches the visible answers word for word", () => {
  const graph = contactPageSchema["@graph"];
  const types = graph.map((node) => node["@type"]);
  assert.deepEqual(types, ["ContactPage", "BreadcrumbList", "FAQPage"]);
  const page = graph[0];
  assert.equal(page.url, "https://p5homeco.com/contact");
  assert.equal(page.about["@id"], "https://p5homeco.com/#organization");
  assert.equal(page.mainEntity["@id"], "https://p5homeco.com/#organization");
  const faq = graph[2];
  assert.equal(faq.mainEntity.length, CONTACT_FAQS.length);
  assert.equal(faq.mainEntity.length, 8);
  for (let i = 0; i < CONTACT_FAQS.length; i += 1) {
    assert.equal(faq.mainEntity[i].name, CONTACT_FAQS[i].q);
    assert.equal(faq.mainEntity[i].acceptedAnswer.text, CONTACT_FAQS[i].a);
  }
  const questions = new Set(CONTACT_FAQS.map((item) => item.q));
  assert.equal(questions.size, CONTACT_FAQS.length);
  assert.equal(CONTACT_FAQS.some((item) => item.a.includes("Middleton") || item.a.includes("Garden City")), false);
  assert.equal(JSON.stringify(contactPageSchema).includes("boiseadu.co"), false);
});

test("the contact page is self-canonical, mapped, and does not invite a visit", () => {
  const page = readFileSync("app/contact/page.tsx", "utf8");
  const chat = readFileSync("app/contact/ContactChat.tsx", "utf8");
  assert.match(page, /canonical: "\/contact"/);
  assert.match(page, /<h1 id="contact-heading">Contact P5 Home Co<\/h1>/);
  assert.match(page, /title="P5 Home Co service area map"/);
  assert.match(page, /loading="lazy"/);
  assert.match(page, /src=\{P5_GBP_MAP_EMBED_URL\}/);
  assert.match(page, /sms:\+12084771169|PUBLIC_PHONE_SMS/);
  assert.match(page, /<h2 id="contact-questions">Common questions<\/h2>/);
  assert.match(page, /<h3>\{item\.q\}<\/h3>/);
  assert.match(page, /<Answer text=\{item\.a\} \/>/);
  assert.match(chat, /p5:chat-open|chat\.openEvent/);
  const flat = `${page}\n${chat}\n${readFileSync("app/contact/content.ts", "utf8")}`;
  assert.doesNotMatch(flat, /visit us|stop by|get directions|directions to|boiseadu\.co/i);
  assert.equal(flat.includes("\u2014") || flat.includes("\u2013"), false);
  assert.equal(P5_GBP_MAP_EMBED_URL.includes(P5_GBP_PLACE_ID), true);
  assert.equal(P5_GBP_MAP_EMBED_URL.toLowerCase().includes(["wa", "poot"].join("")), false);
  assert.ok(sitemap().some((entry) => entry.url === "https://p5homeco.com/contact"));
});

test("published hours stay tied to the confirmed office hours", () => {
  for (const day of ["tuesday", "wednesday", "thursday", "friday"] as const) {
    assert.equal(BUSINESS_HOURS[day], BUSINESS_HOURS.monday);
  }
  assert.equal(CONTACT_HOURS[0].value, "9 AM to 6 PM");
  assert.equal(CONTACT_HOURS[1].value, "9 AM to 4 PM");
  assert.equal(CONTACT_HOURS[2].value, "Closed");
  assert.equal(BUSINESS_HOURS.sunday, "Closed");
});
