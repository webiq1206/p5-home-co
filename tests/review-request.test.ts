/**
 * The Google review request (owner decision, 20 November 2026).
 *
 * The words and the rules run without a database: off by default, the email
 * names the brand and the P5 Home Co profile, links the review page, and
 * carries no incentive, no gating, no stars and no em dash. With
 * TEST_DATABASE_URL (a throwaway Postgres with tools/migrate.ts applied) the
 * queue runs for real against a fake mail transport: once per lead, never for
 * a removed, merged, test or address-less lead, and nothing at all while the
 * switch is off. No real email is ever sent. The paid in full hook itself is
 * driven end to end in tests/stage-alignment.integration.test.ts.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BRAND_CONFIGS } from "../app/lib/estimator/brands.ts";
import {
  DEFAULT_REVIEW_DELAY_HOURS,
  GOOGLE_REVIEW_URL,
  REVIEW_BUTTON_LABEL,
  isTestLead,
  reviewBrand,
  reviewRequestBlocker,
  reviewRequestDelayHours,
  reviewRequestEmail,
  reviewRequestEnabled,
  type ReviewLead,
} from "../app/lib/leads/reviewRequest.ts";
import { SYNTHETIC_ESTIMATOR_FORM } from "../app/lib/leads/synthetic-qa.ts";
import type { Message } from "../app/lib/notifications/render.ts";
import type { Transport } from "../app/lib/notifications/transport.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const INCENTIVE = /\b(?:gift|gifts|discount|discounts|entry|entries|enter|free|reward|rewards|coupon|coupons|prize|prizes|raffle|drawing|giveaway|card|credit|cash|money|bonus|%\s*off|\$\d)/i;
const GATING = /\b(?:happy|satisfied|satisfaction|enjoyed|loved|positive|great experience|good experience|5[\s-]?star|five[\s-]?star|stars?|rate us|rating|were you|if you (?:liked|enjoyed|were)|not happy|unhappy|before you review|let us know first|tell us first)\b/i;
const REPLY_PROMISE = /\b(?:within|in)\s+(?:\d+|a|one|an|24)\s+(?:minutes?|hours?|days?|business days?)\b|\bsame[\s-]day\b|\bshortly\b|\bright away\b|\bpromptly\b/i;
const EM_DASH = /—|–/;

const lead = (extra: Partial<ReviewLead> = {}): ReviewLead => ({
  stage: "Closed Won", originalForm: "estimator", firstName: "Jordan", lastName: "Lee", email: "jordan@homeowner.test", removed: false, ...extra,
});

describe("review request: the switch and the delay", () => {
  test("off unless REVIEW_REQUEST is exactly on", () => {
    assert.equal(reviewRequestEnabled({}), false, "off by default");
    for (const value of ["", "off", "true", "1", "yes", "enabled", "onn"]) assert.equal(reviewRequestEnabled({ REVIEW_REQUEST: value }), false, value);
    for (const value of ["on", "ON", " On "]) assert.equal(reviewRequestEnabled({ REVIEW_REQUEST: value }), true, value);
  });

  test("the delay is 24 hours unless set; 0 sends on the spot; nonsense falls back; a fortnight at most", () => {
    assert.equal(DEFAULT_REVIEW_DELAY_HOURS, 24);
    assert.equal(reviewRequestDelayHours({}), 24);
    assert.equal(reviewRequestDelayHours({ REVIEW_REQUEST_DELAY_HOURS: "0" }), 0);
    assert.equal(reviewRequestDelayHours({ REVIEW_REQUEST_DELAY_HOURS: "48" }), 48);
    assert.equal(reviewRequestDelayHours({ REVIEW_REQUEST_DELAY_HOURS: "1.5" }), 1.5);
    for (const value of ["-1", "abc", "Infinity", "NaN", " "]) assert.equal(reviewRequestDelayHours({ REVIEW_REQUEST_DELAY_HOURS: value }), 24, value);
    assert.equal(reviewRequestDelayHours({ REVIEW_REQUEST_DELAY_HOURS: "10000" }), 336);
  });
});

describe("review request: who is asked", () => {
  test("a finished, won, real lead with an email address may be asked", () => {
    assert.equal(reviewRequestBlocker(lead()), null);
  });

  test("never a lead that is not Closed Won, including one closed as removed or merged", () => {
    for (const stage of ["New Lead", "Contacting", "Estimate Sent", "Decision Pending", "Closed Lost", null]) {
      assert.ok(reviewRequestBlocker(lead({ stage })), `${stage}`);
    }
  });

  test("never a won lead that was removed or merged in HubSpot or QuickBooks", () => {
    assert.match(reviewRequestBlocker(lead({ removed: true })) ?? "", /removed or merged/);
  });

  test("never a synthetic or QA lead", () => {
    assert.ok(isTestLead({ originalForm: SYNTHETIC_ESTIMATOR_FORM, firstName: "Jordan", lastName: null, email: "jordan@homeowner.test" }));
    assert.ok(isTestLead({ originalForm: null, firstName: "[QA]", lastName: "Kitchen", email: "jordan@homeowner.test" }));
    assert.ok(isTestLead({ originalForm: null, firstName: "[qa] Jordan", lastName: null, email: "jordan@homeowner.test" }));
    assert.ok(isTestLead({ originalForm: null, firstName: "Jordan", lastName: null, email: "qa@example.invalid" }));
    assert.equal(isTestLead({ originalForm: "estimator", firstName: "Jordan", lastName: "Qadir", email: "jordan@homeowner.test" }), false);
    assert.match(reviewRequestBlocker(lead({ originalForm: SYNTHETIC_ESTIMATOR_FORM })) ?? "", /test lead/);
  });

  test("never without a customer email address", () => {
    for (const email of [null, "", "  ", "not an email", "jordan@", "@homeowner.test"]) {
      assert.match(reviewRequestBlocker(lead({ email })) ?? "", /no usable email/, String(email));
    }
  });
});

describe("review request: the email", () => {
  const brands = Object.values(BRAND_CONFIGS);

  for (const brand of brands) {
    test(`${brand.name}: the review link, the brand, the P5 Home Co profile and nothing Google forbids`, () => {
      const message = reviewRequestEmail({ firstName: "Jordan", brandName: brand.name });
      const words = `${message.subject}\n${message.text}\n${visible(message.html)}`;
      assert.equal(message.subject, "How did we do, Jordan?");
      assert.ok(message.text.includes(`${REVIEW_BUTTON_LABEL}: ${GOOGLE_REVIEW_URL}`), "the text version carries the link");
      assert.ok(message.html.includes(`href="${GOOGLE_REVIEW_URL}"`), "the button links the review page");
      assert.equal((message.html.match(/<a /g) ?? []).length, 1, "one button, one link");
      assert.match(message.text, new RegExp(`Thank you for choosing ${brand.name}\\.`));
      assert.match(message.text, new RegExp(`The ${brand.name} team\\s*$`));
      assert.ok(message.text.includes("P5 Home Co Google profile"), "says where the review goes");
      if (brand.name !== "P5 Home Co") assert.ok(message.text.includes(`${brand.name} is part of P5 Home Co, our parent company`));
      assert.ok(message.html.includes(brand.accent), "the button carries the brand accent");
      assert.doesNotMatch(words, EM_DASH, "no em or en dash");
      assert.doesNotMatch(words, INCENTIVE, "no incentive of any kind");
      assert.doesNotMatch(words, GATING, "no gating: nobody is asked whether they were happy first");
      assert.doesNotMatch(words, REPLY_PROMISE, "no promise of when anyone replies");
      assert.doesNotMatch(message.html, /<img|&#9733;|★|☆|star/i, "no star images or star characters");
      assert.doesNotMatch(words, /\bquote\b|\bbid\b/i);
      assert.ok(visible(message.html).includes(REVIEW_BUTTON_LABEL));
    });
  }

  test("the link is Google's write-a-review page for the P5 Home Co profile", () => {
    assert.equal(GOOGLE_REVIEW_URL, "https://search.google.com/local/writereview?placeid=ChIJzxMoavs6P6IRNc6i9aOvt6Q");
  });

  test("the same words for everyone: only the name and the brand change", () => {
    const strip = (m: Message) => m.text.replaceAll("Jordan", "X").replaceAll("Sam", "X");
    assert.equal(strip(reviewRequestEmail({ firstName: "Jordan", brandName: "Boise Cabinet Co" })), strip(reviewRequestEmail({ firstName: "Sam", brandName: "Boise Cabinet Co" })));
  });

  test("no first name: a plain subject and greeting; a full name greets by the first word; markup never reaches the subject", () => {
    const none = reviewRequestEmail({ firstName: null, brandName: "Boise Handyman Co" });
    assert.equal(none.subject, "How did we do?");
    assert.match(none.text, /^Hi there,/);
    assert.equal(reviewRequestEmail({ firstName: "  Mary Ann ", brandName: null }).subject, "How did we do, Mary?");
    const odd = reviewRequestEmail({ firstName: "<b>Jo</b>", brandName: null });
    assert.doesNotMatch(odd.subject, /[<>]/);
    assert.doesNotMatch(odd.html, /<b>Jo/);
  });

  test("an unknown or missing brand signs as P5 Home Co, never as a made-up name", () => {
    assert.deepEqual(reviewBrand("Someone Else LLC"), { name: "P5 Home Co", accent: BRAND_CONFIGS.p5.accent });
    assert.deepEqual(reviewBrand(null), { name: "P5 Home Co", accent: BRAND_CONFIGS.p5.accent });
    assert.equal(reviewBrand("Boise Remodeling Co").accent, BRAND_CONFIGS.remodeling.accent);
    const p5 = reviewRequestEmail({ firstName: "Jordan", brandName: "P5 Home Co" });
    assert.match(p5.text, /Reviews for our work go on the P5 Home Co Google profile\./);
  });

  test("the words live in one module, and no SMS is sent", () => {
    const send = read("app/lib/leads/reviewRequestSend.ts");
    assert.doesNotMatch(send, /How did we do|Leave a Google review|writereview/, "the sender holds no wording of its own");
    assert.doesNotMatch(send, /sms|twilio/i);
  });
});

describe("review request: where it is wired", () => {
  test("the paid in full follow-up asks for the review right after the Job Complete move", () => {
    const source = read("app/lib/leads/stage-alignment.ts");
    assert.match(source, /if \(status === "paid"\) \{\s*await completeJobInHubSpot\(dealId\);\s*await askForReviewWhenComplete\(dealId\);\s*\}/);
    const hook = source.slice(source.indexOf("export async function askForReviewWhenComplete"));
    const body = hook.slice(0, hook.indexOf("\n}\n"));
    assert.ok(body.indexOf("reviewRequestEnabled()") < body.indexOf("leadForJob(dealId)"), "off reads nothing");
    assert.match(body, /lead\.stage !== "Closed Won"/);
    assert.match(body, /leadJobPaid\(dealId\)/);
    assert.match(body, /scheduleReviewRequest\(dealId/);
    assert.match(body, /catch \(error\)/, "never throws into the paid path");
  });

  test("the watchdog sends what is due, inside its own try", () => {
    const watchdog = read("app/lib/leads/watchdog.ts");
    assert.match(watchdog, /try \{\s*const \{ settleReviewRequests \} = await import\("\.\/reviewRequestSend\.ts"\);\s*await settleReviewRequests\(\{ now \}\);\s*\} catch/);
  });
});

describe("review request: off sends and queues nothing, with no database at all", () => {
  const saved = { REVIEW_REQUEST: process.env.REVIEW_REQUEST, DATABASE_URL: process.env.DATABASE_URL };
  before(() => { delete process.env.REVIEW_REQUEST; delete process.env.DATABASE_URL; });
  after(() => {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  });

  test("every entry point returns before touching the database or the mail", async () => {
    const send = await import("../app/lib/leads/reviewRequestSend.ts");
    const { askForReviewWhenComplete } = await import("../app/lib/leads/stage-alignment.ts");
    let mailed = 0;
    const transport: Transport = { name: "fake", async send() { mailed++; return { ok: true }; } };
    assert.equal(await send.scheduleReviewRequest(1, {}, { transport }), "off");
    assert.equal(await send.sendReviewRequest(1, { transport }), "off");
    assert.deepEqual(await send.settleReviewRequests({ transport }), { attempted: 0, sent: 0 });
    await askForReviewWhenComplete(1);
    assert.equal(mailed, 0);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe("review request: the queue, against a real database", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let send: typeof import("../app/lib/leads/reviewRequestSend.ts");
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  const ENV = ["DATABASE_URL", "REVIEW_REQUEST", "REVIEW_REQUEST_DELAY_HOURS", "SMTP_USER", "SMTP_PASSWORD"] as const;
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  let outbox: { to: string; message: Message }[];
  let failNext: number;
  const transport: Transport = {
    name: "fake",
    async send(to, message) {
      if (failNext > 0) { failNext--; return { ok: false, error: "mail server said no" }; }
      outbox.push({ to, message });
      return { ok: true };
    },
  };
  const HOUR = 3_600_000;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    delete process.env.SMTP_USER; delete process.env.SMTP_PASSWORD;
    send = await import("../app/lib/leads/reviewRequestSend.ts");
    ({ query, getPool } = await import("../app/lib/db.ts"));
  });
  after(async () => {
    await getPool().end();
    for (const name of ENV) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  });
  beforeEach(async () => {
    outbox = [];
    failNext = 0;
    process.env.REVIEW_REQUEST = "on";
    delete process.env.REVIEW_REQUEST_DELAY_HOURS;
    await query("TRUNCATE deal,contact,audit_log RESTART IDENTITY CASCADE");
  });

  /** A won lead. Returns its id. */
  async function wonLead(extra: { email?: string | null; firstName?: string; form?: string; stage?: string; reason?: string | null; brand?: string } = {}): Promise<number> {
    const [contact] = await query<{ id: number }>(
      "INSERT INTO contact (identity_key,first_name,last_name,email) VALUES ($1,$2,'Lee',$3) RETURNING id::int AS id",
      [`email:${Math.random()}`, extra.firstName ?? "Jordan", extra.email === undefined ? "jordan@homeowner.test" : extra.email],
    );
    const [deal] = await query<{ id: number }>(
      `INSERT INTO deal (contact_id,name,brand,lead_source,stage,received_at,original_form,closed_lost_reason,closed_at)
       VALUES ($1,'Kitchen',$2,'Organic Website',$3,now()-interval '30 days',$4,$5,now()) RETURNING id::int AS id`,
      [contact.id, extra.brand ?? "Boise Cabinet Co", extra.stage ?? "Closed Won", extra.form ?? "estimator", extra.reason ?? null],
    );
    return deal.id;
  }
  const rows = (action: string, dealId?: number) => query<{ record_id: string; new_value: Record<string, unknown>; succeeded: boolean; error: string | null }>(
    `SELECT record_id,new_value,succeeded,error FROM audit_log WHERE action=$1 ${dealId ? "AND record_id=$2" : ""} ORDER BY id`,
    dealId ? [action, String(dealId)] : [action],
  );
  const reviewRows = () => query("SELECT action FROM audit_log WHERE action LIKE 'review_request%'");

  test("off: a completed job queues nothing and sends nothing, and turning it off holds back what was queued", async () => {
    delete process.env.REVIEW_REQUEST;
    const id = await wonLead();
    assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "off");
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(Date.now() + 48 * HOUR) }), { attempted: 0, sent: 0 });
    assert.deepEqual(await reviewRows(), []);

    process.env.REVIEW_REQUEST = "on";
    assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "queued");
    process.env.REVIEW_REQUEST = "off";
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(Date.now() + 48 * HOUR) }), { attempted: 0, sent: 0 });
    assert.equal(outbox.length, 0);
  });

  test("queued for 24 hours by default, sent once when due, and never again for that lead", async () => {
    const id = await wonLead();
    const now = new Date();
    assert.equal(await send.scheduleReviewRequest(id, { docNumbers: ["1090"] }, { transport, now }), "queued");
    const [queued] = await rows(send.REVIEW_QUEUED, id);
    assert.equal(queued.new_value.delayHours, 24);
    assert.equal(new Date(String(queued.new_value.dueAt)).getTime(), now.getTime() + 24 * HOUR);
    assert.deepEqual(queued.new_value.docNumbers, ["1090"]);

    // The paid path notices the same job again (another invoice, the daily sync).
    assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "already");
    assert.equal((await rows(send.REVIEW_QUEUED)).length, 1);

    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(now.getTime() + 23 * HOUR) }), { attempted: 0, sent: 0 }, "not before it is due");
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(now.getTime() + 25 * HOUR) }), { attempted: 1, sent: 1 });
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, "jordan@homeowner.test");
    assert.equal(outbox[0].message.subject, "How did we do, Jordan?");
    assert.ok(outbox[0].message.text.includes(GOOGLE_REVIEW_URL));
    assert.ok(outbox[0].message.text.includes("Boise Cabinet Co"), "from the brand that did the job");
    const [sent] = await rows(send.REVIEW_SENT, id);
    assert.equal(sent.new_value.brand, "Boise Cabinet Co");

    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(now.getTime() + 30 * HOUR) }), { attempted: 0, sent: 0 });
    assert.equal(await send.sendReviewRequest(id, { transport }), "already");
    assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "already");
    assert.equal(outbox.length, 1, "one email per lead, ever");
  });

  test("REVIEW_REQUEST_DELAY_HOURS=0 sends on the spot, once", async () => {
    process.env.REVIEW_REQUEST_DELAY_HOURS = "0";
    const id = await wonLead({ brand: "Boise Handyman Co" });
    assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "sent");
    assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "already");
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(Date.now() + HOUR) }), { attempted: 0, sent: 0 });
    assert.equal(outbox.length, 1);
    assert.match(outbox[0].message.text, /The Boise Handyman Co team/);
  });

  test("two sends racing for the same lead send one email", async () => {
    process.env.REVIEW_REQUEST_DELAY_HOURS = "0";
    const id = await wonLead();
    await send.scheduleReviewRequest(id, {}, { transport: { name: "hold", async send() { return { ok: false, error: "held" }; } } });
    // One failed attempt is on record; the next two calls race.
    const outcomes = await Promise.all([send.sendReviewRequest(id, { transport }), send.sendReviewRequest(id, { transport })]);
    assert.deepEqual(outcomes.sort(), ["already", "sent"]);
    assert.equal(outbox.length, 1);
  });

  test("never for a lead removed in HubSpot or QuickBooks, or merged into another deal, even one that stays won", async () => {
    const removed = await wonLead();
    await query(`INSERT INTO audit_log (record_type,record_id,action,action_source,new_value) VALUES ('deal',$1,'hubspot_deal_removed','integration','{"hubspotDealId":"9"}')`, [String(removed)]);
    const qboRemoved = await wonLead();
    await query(`INSERT INTO audit_log (record_type,record_id,action,action_source,new_value) VALUES ('deal',$1,'quickbooks_estimate_removed','integration','{}')`, [String(qboRemoved)]);
    const merged = await wonLead();
    await query(`INSERT INTO audit_log (record_type,record_id,action,action_source,new_value) VALUES ('deal',$1,'hubspot_deal_merged','integration','{"duplicate":true}')`, [String(merged)]);
    const lostRemoved = await wonLead({ stage: "Closed Lost", reason: "Removed in HubSpot" });
    const lostMerged = await wonLead({ stage: "Closed Lost", reason: "Merged into another deal in HubSpot" });
    for (const id of [removed, qboRemoved, merged, lostRemoved, lostMerged]) {
      assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "skipped", `lead ${id}`);
    }
    // A merge the lead simply followed (no duplicate) is not a removal.
    const followed = await wonLead();
    await query(`INSERT INTO audit_log (record_type,record_id,action,action_source,new_value) VALUES ('deal',$1,'hubspot_deal_merged','integration','{"from":"9","into":"10"}')`, [String(followed)]);
    assert.equal(await send.scheduleReviewRequest(followed, {}, { transport }), "queued");
    assert.equal((await rows(send.REVIEW_QUEUED)).length, 1);
  });

  test("never for a synthetic or QA lead, or a lead with no email address; a skip is noted once", async () => {
    const synthetic = await wonLead({ form: SYNTHETIC_ESTIMATOR_FORM });
    const qaName = await wonLead({ firstName: "[QA] Kitchen" });
    const qaMail = await wonLead({ email: "qa@example.invalid" });
    const noEmail = await wonLead({ email: null });
    for (const id of [synthetic, qaName, qaMail, noEmail]) {
      assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "skipped");
      assert.equal(await send.scheduleReviewRequest(id, {}, { transport }), "skipped");
    }
    assert.equal((await rows(send.REVIEW_QUEUED)).length, 0);
    assert.equal((await rows(send.REVIEW_SKIPPED)).length, 4, "one note per lead, not one per pass");
    assert.match(String((await rows(send.REVIEW_SKIPPED, noEmail))[0].new_value.reason), /no usable email/);
    assert.equal(outbox.length, 0);
  });

  test("every rule is checked again when the email is due: a lead reopened or removed meanwhile is not emailed", async () => {
    const reopened = await wonLead();
    const removedLater = await wonLead();
    const now = new Date();
    for (const id of [reopened, removedLater]) assert.equal(await send.scheduleReviewRequest(id, {}, { transport, now }), "queued");
    await query("UPDATE deal SET stage='Decision Pending', closed_at=NULL WHERE id=$1", [reopened]);
    await query(`INSERT INTO audit_log (record_type,record_id,action,action_source,new_value) VALUES ('deal',$1,'hubspot_deal_removed','integration','{}')`, [String(removedLater)]);
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(now.getTime() + 25 * HOUR) }), { attempted: 2, sent: 0 });
    assert.equal(outbox.length, 0);
    assert.equal((await rows(send.REVIEW_SKIPPED)).length, 2);
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(now.getTime() + 26 * HOUR) }), { attempted: 0, sent: 0 }, "a skip is final");
  });

  test("a failed send is retried six hours apart, three tries at most, and recorded each time", async () => {
    const id = await wonLead();
    // Queued a day ago, so it is due now; the failures are stamped with the real clock.
    await send.scheduleReviewRequest(id, {}, { transport, now: new Date(Date.now() - 25 * HOUR) });
    failNext = 5;
    const start = Date.now();
    const at = (hours: number) => new Date(start + hours * HOUR);
    assert.deepEqual(await send.settleReviewRequests({ transport, now: at(0) }), { attempted: 1, sent: 0 });
    assert.deepEqual(await send.settleReviewRequests({ transport, now: at(1) }), { attempted: 0, sent: 0 }, "waits six hours");
    assert.deepEqual(await send.settleReviewRequests({ transport, now: at(7) }), { attempted: 1, sent: 0 });
    assert.deepEqual(await send.settleReviewRequests({ transport, now: at(14) }), { attempted: 1, sent: 0 });
    assert.deepEqual(await send.settleReviewRequests({ transport, now: at(21) }), { attempted: 0, sent: 0 }, "given up after three");
    const failed = await rows(send.REVIEW_FAILED, id);
    assert.equal(failed.length, 3);
    assert.ok(failed.every((row) => !row.succeeded && row.error === "mail server said no"));
    assert.equal(outbox.length, 0);
  });

  test("a send that may have reached the customer, with no outcome recorded, is never tried again", async () => {
    const id = await wonLead();
    const now = new Date();
    await send.scheduleReviewRequest(id, {}, { transport, now });
    // A crash after the claim and before the outcome.
    await query(`INSERT INTO audit_log (record_type,record_id,action,action_source,new_value) VALUES ('deal',$1,'review_request_sending','job','{"attempt":1}')`, [String(id)]);
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(now.getTime() + 25 * HOUR) }), { attempted: 0, sent: 0 });
    assert.equal(await send.sendReviewRequest(id, { transport }), "already");
    assert.equal(outbox.length, 0);
  });

  test("a request more than a fortnight overdue is skipped, not sent late", async () => {
    const id = await wonLead();
    const now = new Date();
    await send.scheduleReviewRequest(id, {}, { transport, now });
    assert.deepEqual(await send.settleReviewRequests({ transport, now: new Date(now.getTime() + 24 * HOUR + 15 * 24 * HOUR) }), { attempted: 0, sent: 0 });
    assert.match(String((await rows(send.REVIEW_SKIPPED, id))[0].new_value.reason), /fortnight overdue/);
    assert.equal(outbox.length, 0);
  });
});
